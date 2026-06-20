import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '@/lib/tauri-runtime';

export type AudioLoadStrategy = 'asset' | 'blob-fs' | 'blob-backend';

export interface ResolvedAudioUrl {
  url: string;
  strategy: AudioLoadStrategy;
  revoke?: () => void;
}

const MIME_BY_EXT: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || 'wav';
  return MIME_BY_EXT[ext] || 'audio/wav';
}

async function normalizeAudioPath(filePath: string): Promise<string> {
  const trimmed = filePath.trim();
  if (!trimmed) return trimmed;

  if (!isTauriRuntime()) {
    return trimmed;
  }

  try {
    const { normalize } = await import('@tauri-apps/api/path');
    return await normalize(trimmed);
  } catch {
    return trimmed;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  if (!isTauriRuntime()) return true;

  try {
    const { exists } = await import('@tauri-apps/plugin-fs');
    return await exists(filePath);
  } catch {
    return false;
  }
}

async function getFileSize(filePath: string): Promise<number> {
  if (!isTauriRuntime()) return 0;

  try {
    const { stat } = await import('@tauri-apps/plugin-fs');
    const info = await stat(filePath);
    return Number(info.size ?? 0);
  } catch {
    return 0;
  }
}

function timeoutForFileSize(bytes: number): number {
  if (bytes >= 40 * 1024 * 1024) return 15000;
  if (bytes >= 15 * 1024 * 1024) return 10000;
  if (bytes >= 5 * 1024 * 1024) return 8000;
  return 5000;
}

export async function waitForReadableAudioFile(
  filePath: string,
  options?: { timeoutMs?: number; pollMs?: number; minBytes?: number }
): Promise<number> {
  const pollMs = options?.pollMs ?? 80;
  const minBytes = options?.minBytes ?? 512;
  const started = Date.now();
  let lastSize = -1;
  let stableReads = 0;
  let timeoutMs = options?.timeoutMs ?? 5000;

  while (Date.now() - started < timeoutMs) {
    if (!(await fileExists(filePath))) {
      await sleep(pollMs);
      continue;
    }

    const size = await getFileSize(filePath);
    timeoutMs = Math.max(timeoutMs, timeoutForFileSize(size));

    if (size >= minBytes) {
      if (size === lastSize) {
        stableReads += 1;
      } else {
        stableReads = 0;
        lastSize = size;
      }

      if (stableReads >= 2) {
        return size;
      }
    }

    await sleep(pollMs);
  }

  throw new Error(`Audio file not ready: ${filePath}`);
}

function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  // Copy bytes so Blob is not backed by a potentially-shared ArrayBuffer view.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: mimeType });
}

function createObjectUrlFromBytes(bytes: Uint8Array, mimeType: string): ResolvedAudioUrl {
  const blob = bytesToBlob(bytes, mimeType);
  const url = URL.createObjectURL(blob);
  return {
    url,
    strategy: 'blob-fs',
    revoke: () => URL.revokeObjectURL(url),
  };
}

async function loadViaFsBlob(filePath: string): Promise<ResolvedAudioUrl> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(filePath);
  if (!bytes?.byteLength) {
    throw new Error(`FS read returned empty file: ${filePath}`);
  }
  return createObjectUrlFromBytes(bytes, getMimeType(filePath));
}

async function loadViaBackendBlob(filePath: string): Promise<ResolvedAudioUrl> {
  const payload = await invoke<{ data_base64: string; mime_type: string }>('read_audio_file', {
    path: filePath,
  });

  if (!payload?.data_base64) {
    throw new Error(`Backend read returned empty payload: ${filePath}`);
  }

  const binary = atob(payload.data_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return {
    ...createObjectUrlFromBytes(bytes, payload.mime_type || getMimeType(filePath)),
    strategy: 'blob-backend',
  };
}

function assetCandidates(filePath: string): string[] {
  const primary = convertFileSrc(filePath);
  return [primary, `${primary}#t=${Date.now()}`, `${primary}?v=${Date.now()}`];
}

export async function buildAudioSourceCandidates(filePath: string): Promise<ResolvedAudioUrl[]> {
  const normalizedPath = await normalizeAudioPath(filePath);
  if (!normalizedPath) {
    throw new Error('Audio path is empty');
  }

  if (!isTauriRuntime()) {
    return [{ url: normalizedPath, strategy: 'asset' }];
  }

  // FS blob first — reads file directly, no protocol roundtrip
  const candidates: ResolvedAudioUrl[] = [];
  try {
    candidates.push(await loadViaFsBlob(normalizedPath));
  } catch (error) {
    console.warn('[audio-loader] FS blob candidate failed:', error);
    // If FS blob fails, wait for file to be ready then retry once
    try {
      await waitForReadableAudioFile(normalizedPath, { timeoutMs: 3000, pollMs: 50 });
      candidates.push(await loadViaFsBlob(normalizedPath));
    } catch (retryError) {
      console.warn('[audio-loader] FS blob retry failed:', retryError);
    }
  }

  // Backend blob fallback
  try {
    candidates.push(await loadViaBackendBlob(normalizedPath));
  } catch (error) {
    console.warn('[audio-loader] Backend blob candidate failed:', error);
  }

  // Asset protocol last — only works for bundled resources
  assetCandidates(normalizedPath).forEach((url) => {
    candidates.push({ url, strategy: 'asset' as const });
  });

  if (candidates.length === 0) {
    throw new Error(`No audio loading strategy available for ${normalizedPath}`);
  }

  return candidates;
}

export async function loadWaveSurferSource(
  filePath: string,
  load: (url: string) => Promise<void>,
  options?: { maxPasses?: number }
): Promise<ResolvedAudioUrl> {
  const maxPasses = options?.maxPasses ?? 3;
  let lastError: unknown = null;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    try {
      const candidates = await buildAudioSourceCandidates(filePath);

      for (const candidate of candidates) {
        try {
          await load(candidate.url);
          return candidate;
        } catch (error) {
          lastError = error;
          candidate.revoke?.();
          console.warn(`[audio-loader] WaveSurfer rejected ${candidate.strategy}:`, error);
        }
      }
    } catch (error) {
      lastError = error;
    }

    if (pass < maxPasses) {
      await sleep(200);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to load audio after ${maxPasses} passes`);
}