import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '@/lib/tauri-runtime';

export type AudioLoadStrategy = 'asset' | 'blob-fs' | 'blob-backend';

export type AudioLoadStage = 'waiting' | 'reading' | 'decoding' | 'ready' | 'error';

export interface AudioLoadProgress {
  stage: AudioLoadStage;
  percent: number;
  detail: string;
  bytesRead?: number;
  bytesTotal?: number;
}

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

/** Strip Win32 `\\?\` extended prefix — Tauri FS plugin cannot stat those paths. */
function sanitizeWindowsPath(filePath: string): string {
  let path = filePath.trim();
  if (path.startsWith('\\\\?\\')) {
    path = path.slice(4);
  }
  return path;
}

async function normalizeAudioPath(filePath: string): Promise<string> {
  const trimmed = sanitizeWindowsPath(filePath);
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

function emitProgress(
  onProgress: ((p: AudioLoadProgress) => void) | undefined,
  progress: AudioLoadProgress
) {
  onProgress?.(progress);
}

export async function waitForReadableAudioFile(
  filePath: string,
  options?: { timeoutMs?: number; pollMs?: number; minBytes?: number; onProgress?: (p: AudioLoadProgress) => void }
): Promise<number> {
  const resolvedPath = await normalizeAudioPath(filePath);
  const pollMs = options?.pollMs ?? 80;
  const minBytes = options?.minBytes ?? 512;
  const started = Date.now();
  let lastSize = -1;
  let stableReads = 0;
  let timeoutMs = options?.timeoutMs ?? 5000;

  emitProgress(options?.onProgress, {
    stage: 'waiting',
    percent: 2,
    detail: 'Waiting for stem file…',
  });

  while (Date.now() - started < timeoutMs) {
    const elapsed = Date.now() - started;
    const waitPct = Math.min(18, 2 + Math.floor((elapsed / timeoutMs) * 16));

    if (!(await fileExists(resolvedPath))) {
      emitProgress(options?.onProgress, {
        stage: 'waiting',
        percent: waitPct,
        detail: 'Stem file finishing write…',
      });
      await sleep(pollMs);
      continue;
    }

    const size = await getFileSize(resolvedPath);
    timeoutMs = Math.max(timeoutMs, timeoutForFileSize(size));

    emitProgress(options?.onProgress, {
      stage: 'waiting',
      percent: Math.min(20, waitPct + 2),
      detail: size > 0 ? `File detected (${formatBytes(size)})` : 'Checking file size…',
      bytesTotal: size,
    });

    if (size >= minBytes) {
      if (size === lastSize) {
        stableReads += 1;
      } else {
        stableReads = 0;
        lastSize = size;
      }

      if (stableReads >= 2) {
        emitProgress(options?.onProgress, {
          stage: 'waiting',
          percent: 20,
          detail: `File ready (${formatBytes(size)})`,
          bytesTotal: size,
        });
        return size;
      }
    }

    await sleep(pollMs);
  }

  throw new Error(`Audio file not ready: ${resolvedPath}`);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
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

function normalizeBytePayload(data: number[] | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

async function loadViaBackendBlob(filePath: string): Promise<ResolvedAudioUrl> {
  try {
    const binaryPayload = await invoke<{ data: number[] | Uint8Array; mime_type: string }>(
      'read_audio_file_bytes',
      { path: filePath },
    );
    if (binaryPayload?.data) {
      const bytes = normalizeBytePayload(binaryPayload.data);
      return {
        ...createObjectUrlFromBytes(bytes, binaryPayload.mime_type || getMimeType(filePath)),
        strategy: 'blob-backend',
      };
    }
  } catch (error) {
    console.warn('[audio-loader] Binary backend read failed, falling back to base64:', error);
  }

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

  const candidates: ResolvedAudioUrl[] = [];

  // FS blob first — fastest path, no base64 round-trip
  try {
    candidates.push(await loadViaFsBlob(normalizedPath));
  } catch (error) {
    console.warn('[audio-loader] FS blob candidate failed:', error);
    try {
      await waitForReadableAudioFile(normalizedPath, { timeoutMs: 3000, pollMs: 50 });
      candidates.push(await loadViaFsBlob(normalizedPath));
    } catch (retryError) {
      console.warn('[audio-loader] FS blob retry failed:', retryError);
    }
  }

  // Backend blob fallback — handles Win32 canonical paths
  try {
    candidates.push(await loadViaBackendBlob(normalizedPath));
  } catch (error) {
    console.warn('[audio-loader] Backend blob candidate failed:', error);
  }

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

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Fetch failed (${resp.status}): ${url}`);
  }
  const buffer = await resp.arrayBuffer();
  return buffer.slice(0);
}

export async function loadAudioBuffer(
  filePath: string,
  ctx: AudioContext,
  options?: {
    maxPasses?: number;
    waitForFile?: boolean;
    deferMs?: number;
    onProgress?: (p: AudioLoadProgress) => void;
  }
): Promise<AudioBuffer> {
  const deferMs = options?.deferMs ?? 0;
  if (deferMs > 0) {
    emitProgress(options?.onProgress, { stage: 'waiting', percent: 0, detail: 'Queued…' });
    await sleep(deferMs);
  }

  const resolvedPath = await normalizeAudioPath(filePath);

  if (options?.waitForFile !== false && isTauriRuntime()) {
    try {
      await waitForReadableAudioFile(resolvedPath, {
        timeoutMs: 8000,
        pollMs: 60,
        onProgress: options?.onProgress,
      });
    } catch (error) {
      console.warn('[audio-loader] File readiness wait failed:', error);
    }
  } else {
    emitProgress(options?.onProgress, { stage: 'reading', percent: 20, detail: 'Opening stem…' });
  }

  const maxPasses = options?.maxPasses ?? 3;
  let lastError: unknown = null;
  const bytesTotal = await getFileSize(resolvedPath);

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    try {
      const candidates = await buildAudioSourceCandidates(resolvedPath);

      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const readPct = 20 + Math.floor(((i + 0.5) / candidates.length) * 45);

        emitProgress(options?.onProgress, {
          stage: 'reading',
          percent: readPct,
          detail: `Reading audio (${candidate.strategy})…`,
          bytesTotal: bytesTotal || undefined,
        });

        try {
          const arrayBuffer = await fetchArrayBuffer(candidate.url);

          emitProgress(options?.onProgress, {
            stage: 'decoding',
            percent: 70,
            detail: 'Building waveform…',
            bytesRead: arrayBuffer.byteLength,
            bytesTotal: bytesTotal || arrayBuffer.byteLength,
          });

          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

          emitProgress(options?.onProgress, {
            stage: 'ready',
            percent: 100,
            detail: `Ready · ${audioBuffer.duration.toFixed(1)}s`,
            bytesRead: arrayBuffer.byteLength,
            bytesTotal: bytesTotal || arrayBuffer.byteLength,
          });

          candidate.revoke?.();
          return audioBuffer;
        } catch (error) {
          lastError = error;
          candidate.revoke?.();
          console.warn(`[audio-loader] decode failed (${candidate.strategy}, pass ${pass}):`, error);
        }
      }
    } catch (error) {
      lastError = error;
      console.warn(`[audio-loader] candidate build failed (pass ${pass}):`, error);
    }

    if (pass < maxPasses) {
      emitProgress(options?.onProgress, {
        stage: 'reading',
        percent: 15 + pass * 5,
        detail: `Retrying load (pass ${pass + 1})…`,
      });
      await sleep(120 * pass);
    }
  }

  emitProgress(options?.onProgress, {
    stage: 'error',
    percent: 0,
    detail: 'Waveform load failed',
  });

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to decode audio after ${maxPasses} passes`);
}

export interface WaveformPeaksData {
  peaks: Float32Array;
  barCount: number;
  durationSeconds: number;
}

export function peaksPathForAudio(filePath: string): string {
  return filePath.replace(/\.[^.\\/]+$/, '.peaks.json');
}

export async function loadPeaksFromFile(
  peaksPath: string,
  options?: { onProgress?: (p: AudioLoadProgress) => void; fallbackDuration?: number }
): Promise<WaveformPeaksData> {
  const resolvedPath = await normalizeAudioPath(peaksPath);
  emitProgress(options?.onProgress, {
    stage: 'reading',
    percent: 15,
    detail: 'Loading waveform peaks…',
  });

  let parsed: { bar_count?: number; duration_seconds?: number; peaks?: number[] } | null = null;

  if (isTauriRuntime()) {
    try {
      const payload = await invoke<{ bar_count: number; duration_seconds: number; peaks: number[] }>(
        'read_peaks_file',
        { path: resolvedPath },
      );
      parsed = payload;
    } catch (error) {
      console.warn('[audio-loader] read_peaks_file failed, trying FS:', error);
    }
  }

  if (!parsed) {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const text = await readTextFile(resolvedPath);
    parsed = JSON.parse(text) as { bar_count?: number; duration_seconds?: number; peaks?: number[] };
  }

  const peaksList = parsed?.peaks;
  if (!peaksList?.length) {
    throw new Error(`Peaks file empty: ${resolvedPath}`);
  }

  const result: WaveformPeaksData = {
    peaks: new Float32Array(peaksList),
    barCount: parsed.bar_count ?? peaksList.length,
    durationSeconds: parsed.duration_seconds ?? options?.fallbackDuration ?? 0,
  };

  emitProgress(options?.onProgress, {
    stage: 'ready',
    percent: 100,
    detail: `Peaks ready · ${result.barCount} bars`,
  });

  return result;
}

export function buildPlaybackUrl(filePath: string): string {
  const clean = sanitizeWindowsPath(filePath);
  if (!isTauriRuntime()) return clean;
  return convertFileSrc(clean);
}

/** Downsample audio buffer channel data into peak bars for canvas rendering. */
export function extractWaveformPeaks(buffer: AudioBuffer, barCount: number): Float32Array {
  const data = buffer.getChannelData(0);
  const peaks = new Float32Array(barCount);
  const samplesPerBar = Math.max(1, Math.floor(data.length / barCount));

  for (let i = 0; i < barCount; i++) {
    let peak = 0;
    const start = i * samplesPerBar;
    for (let j = 0; j < samplesPerBar; j++) {
      const v = Math.abs(data[start + j] || 0);
      if (v > peak) peak = v;
    }
    peaks[i] = peak;
  }

  return peaks;
}