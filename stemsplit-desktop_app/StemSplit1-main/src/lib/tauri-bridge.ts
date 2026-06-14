/**
 * IPC Bridge - Frontend-to-Backend Communication Layer
 * Handles all async invocations to Rust backend commands
 */

import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Progress event received from backend
 */
export interface ProgressEvent {
  step: number;
  total_steps: number;
  message: string;
  progress_percent: number;
  timestamp: string;
}

/**
 * Separation result from backend
 */
export interface SeparationResult {
  status: string;
  output_directory: string;
  stems: Record<string, StemInfo>;
  process_duration_seconds: number;
  errors: string[];
}

export interface StemInfo {
  file_path: string;
  format: string;
  duration_seconds: number;
  purity_score?: number;
}

/**
 * Request parameters for stem splitting
 */
export interface StemSplitRequest {
  file_path: string;
  output_dir?: string;
  output_format?: 'wav' | 'mp3';
  mp3_bitrate?: number;
  apply_effects?: boolean;
  pre_split_fx?: string;
  engine?: string;
  stems_count?: number;
  passes?: number;
  model_variant?: string;
  post_fx?: string;
  reference_file?: string;
  extra_models?: string;
  chunk_duration?: number;
  device?: 'auto' | 'cuda' | 'cpu';
}

/**
 * Start the stem split process on the backend
 * @param filePath Path to the audio file
 * @param options Optional parameters for stem splitting
 * @returns Promise with separation result
 */
export async function startStemSplit(
  filePath: string,
  options?: {
    outputDir?: string;
    format?: 'wav' | 'mp3';
    bitrate?: number;
    applyEffects?: boolean;
    preSplitFx?: string; 
    engine?: string;
    stems?: number;
    passes?: number;
    modelVariant?: string;
    postFx?: string;
    referenceFile?: string;
    extraModels?: string;
    chunkDuration?: number;
    device?: 'auto' | 'cuda' | 'cpu';
  }
): Promise<SeparationResult> {
  try {
    console.log(`[IPC] Invoking execute_splice for: ${filePath}`, options);
    const result = await invoke<SeparationResult>('execute_splice', {
      request: {
        file_path: filePath,
        output_dir: options?.outputDir,
        output_format: options?.format || 'wav',
        mp3_bitrate: options?.bitrate || 320,
        apply_effects: options?.applyEffects !== false,
        pre_split_fx: options?.preSplitFx,
        engine: options?.engine,
        stems_count: options?.stems,
        passes: options?.passes,
        model_variant: options?.modelVariant,
        post_fx: options?.postFx,
        reference_file: options?.referenceFile,
        extra_models: options?.extraModels,
        chunk_duration: options?.chunkDuration,
        device: options?.device,
      },
    });
    console.log('[IPC] Separation completed:', result);
    return result;
  } catch (error) {
    console.error('[IPC] Error in execute_splice:', error);
    throw error;
  }
}

/**
 * Cancel the active stem split process
 * @returns Promise with cancellation message
 */
export async function cancelStemSplit(): Promise<string> {
  try {
    console.log('[IPC] Invoking cancel_stem_split');
    const result = await invoke<string>('cancel_stem_split');
    console.log('[IPC] Cancellation successful:', result);
    return result;
  } catch (error) {
    console.error('[IPC] Error in cancel_stem_split:', error);
    throw error;
  }
}

/**
 * Get the current status of the separator
 * @returns Promise with status string
 */
export async function getSeparatorStatus(): Promise<string> {
  try {
    const status = await invoke<string>('get_separator_status');
    return status;
  } catch (error) {
    console.error('[IPC] Error getting separator status:', error);
    throw error;
  }
}

/**
 * Perform a health check on the backend
 * @returns Promise with health status
 */
export async function healthCheck(): Promise<string> {
  try {
    const response = await invoke<string>('health_check');
    return response;
  } catch (error) {
    console.error('[IPC] Health check failed:', error);
    throw error;
  }
}

/**
 * Listen for progress updates from backend
 * @param callback Function to call when progress event is received
 * @returns Unlisten function
 */
export async function onStemSplitProgress(
  callback: (event: ProgressEvent) => void
): Promise<() => void> {
  return await listen<ProgressEvent>('stem-split-progress', (event) => {
    console.log('[IPC] Progress update:', event.payload);
    callback(event.payload);
  });
}

/**
 * Hook-style progress listener for React components
 */
export function useStemSplitProgress(
  callback: (event: ProgressEvent) => void
): void {
  React.useEffect(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      unlisten = await onStemSplitProgress(callback);
    })();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [callback]);
}

/**
 * Complete separation workflow with error handling
 */
export async function separateAudio(
  filePath: string,
  outputDir?: string,
  onProgress?: (event: ProgressEvent) => void
): Promise<SeparationResult> {
  try {
    // Set up progress listener if callback provided
    let unlistenProgress: (() => void) | null = null;
    if (onProgress) {
      unlistenProgress = await onStemSplitProgress(onProgress);
    }

    // Start separation with options
    const result = await startStemSplit(filePath, outputDir ? { outputDir } : undefined);

    // Clean up listener
    if (unlistenProgress) {
      unlistenProgress();
    }

    return result;
  } catch (error) {
    console.error('[IPC] Separation workflow failed:', error);
    throw error;
  }
}

/**
 * Safe cancellation with status check
 */
export async function safeCancelStemSplit(): Promise<boolean> {
  try {
    const status = await getSeparatorStatus();
    if (status === 'processing') {
      await cancelStemSplit();
      return true;
    }
    return false;
  } catch (error) {
    console.error('[IPC] Safe cancellation failed:', error);
    return false;
  }
}

/**
 * Open the results folder in the system file explorer
 * @param path Full absolute path to folder
 */
export async function openResultsFolder(path: string): Promise<void> {
  try {
    console.log(`[IPC] Invoking open_results_folder: ${path}`);
    await invoke('open_results_folder', { path });
  } catch (error) {
    console.error('[IPC] Failed to open results folder:', error);
    throw error;
  }
}

// ============================================================================
// Python Environment Management
// ============================================================================

export interface PythonStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  packages_installed: boolean;
  missing_packages: string[];
}

export interface PythonSetupProgress {
  message: string;
  percent: number;
}

export interface YouTubeDownloadProgress {
  message: string;
  percent: number;
}

export interface YouTubeDownloadResult {
  status: string;
  file_path: string;
  title: string;
  duration_seconds: number;
  output_directory: string;
  uploader?: string | null;
  webpage_url?: string | null;
  mode_used: string;
  formats_available: string[];
}

export interface WhisperProgress {
  message: string;
  percent: number;
}

export interface WhisperTranscriptionRequest {
  inputPath: string;
  preset?: 'none' | 'clean_speech' | 'podcast_voice' | 'noisy_room' | 'phone_call' | 'lyric_slow' | 'vad_clean';
  model?: 'auto' | 'tiny' | 'base' | 'small' | 'medium' | 'large';
  language?: string;
  task?: 'transcribe' | 'translate';
  contentType?: 'default' | 'music_lyrics' | 'podcast' | 'interview' | 'lecture' | 'meeting';
}

export interface WhisperTranscriptionResult {
  status: string;
  text_file: string;
  json_file: string;
  srt_file: string;
  vtt_file: string;
  word_srt_file?: string | null;
  output_directory: string;
  model: string;
  preset: string;
  task: string;
  content_type: string;
  transcript_preview: string;
  segment_count: number;
  detected_language?: string | null;
}

export interface PreSplitProgress {
  message: string;
  percent: number;
}

export interface PreSplitOptions {
  inputPath: string;
  convertWav: boolean;
  normalizeLoudness: boolean;
  hpssPrepass: boolean;
  targetSampleRate: number;
}

export interface PreSplitResult {
  status: string;
  output_path: string;
  duration_seconds: number;
  sample_rate: number;
  channels: number;
  hpss_harmonic?: string | null;
  hpss_percussive?: string | null;
}

/**
 * Check if Python environment is ready for stem splitting
 */
export async function checkPythonStatus(): Promise<PythonStatus> {
  try {
    console.log('[IPC] Checking Python status...');
    const result = await invoke<PythonStatus>('check_python_status');
    console.log('[IPC] Python status:', result);
    return result;
  } catch (error) {
    console.error('[IPC] Failed to check Python status:', error);
    return {
      installed: false,
      path: null,
      version: null,
      packages_installed: false,
      missing_packages: ['torch', 'demucs', 'librosa'],
    };
  }
}

/**
 * Download and setup Python environment
 * @param onProgress Callback for progress updates
 */
export async function setupPythonEnvironment(
  onProgress?: (progress: PythonSetupProgress) => void
): Promise<string> {
  try {
    console.log('[IPC] Starting Python environment setup...');
    
    // Set up progress listener
    let unlisten: (() => void) | null = null;
    if (onProgress) {
      unlisten = await listen<PythonSetupProgress>('python-setup-progress', (event) => {
        onProgress(event.payload);
      });
    }
    
    const result = await invoke<string>('setup_python_environment');
    
    if (unlisten) unlisten();
    
    console.log('[IPC] Python setup complete:', result);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[IPC] Python setup failed:', detail);
    throw new Error(detail);
  }
}

/**
 * Run an aggressive runtime deep repair (hard reset + staged reinstall).
 * @param onProgress Callback for progress updates
 */
export async function deepRepairPythonEnvironment(
  onProgress?: (progress: PythonSetupProgress) => void
): Promise<string> {
  try {
    console.log('[IPC] Starting deep repair for Python environment...');

    let unlisten: (() => void) | null = null;
    if (onProgress) {
      unlisten = await listen<PythonSetupProgress>('python-setup-progress', (event) => {
        onProgress(event.payload);
      });
    }

    const result = await invoke<string>('deep_repair_python_environment');

    if (unlisten) unlisten();

    console.log('[IPC] Python deep repair complete:', result);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[IPC] Python deep repair failed:', detail);
    throw new Error(detail);
  }
}

/**
 * Listen for Python setup progress events
 */
export async function onPythonSetupProgress(
  callback: (progress: PythonSetupProgress) => void
): Promise<() => void> {
  return await listen<PythonSetupProgress>('python-setup-progress', (event) => {
    callback(event.payload);
  });
}

export async function downloadYouTubeAudio(
  url: string,
  mode: string = 'audio_mp3_320',
  onProgress?: (progress: YouTubeDownloadProgress) => void
): Promise<YouTubeDownloadResult> {
  try {
    let unlisten: (() => void) | null = null;
    if (onProgress) {
      unlisten = await listen<YouTubeDownloadProgress>('youtube-download-progress', (event) => {
        onProgress(event.payload);
      });
    }

    const result = await invoke<YouTubeDownloadResult>('download_youtube_audio', {
      request: { url, mode },
    });

    if (unlisten) unlisten();
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[IPC] YouTube download failed:', detail);
    throw new Error(detail);
  }
}

/**
 * Preprocess audio for splitting: WAV conversion, loudness normalization, optional HPSS
 */
export async function preprocessAudioForSplit(
  options: PreSplitOptions,
  onProgress?: (progress: PreSplitProgress) => void
): Promise<PreSplitResult> {
  try {
    let unlisten: (() => void) | null = null;
    if (onProgress) {
      unlisten = await listen<PreSplitProgress>('pre-split-progress', (event) => {
        onProgress(event.payload);
      });
    }

    const result = await invoke<PreSplitResult>('preprocess_audio_for_split', {
      request: {
        input_path: options.inputPath,
        convert_wav: options.convertWav,
        normalize_loudness: options.normalizeLoudness,
        hpss_prepass: options.hpssPrepass,
        target_sample_rate: options.targetSampleRate,
      },
    });

    if (unlisten) unlisten();
    console.log('[IPC] Preprocessing complete:', result);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[IPC] Preprocessing failed:', detail);
    throw new Error(detail);
  }
}

export async function transcribeAudio(
  request: WhisperTranscriptionRequest,
  onProgress?: (progress: WhisperProgress) => void
): Promise<WhisperTranscriptionResult> {
  try {
    let unlisten: (() => void) | null = null;
    if (onProgress) {
      unlisten = await listen<WhisperProgress>('whisper-progress', (event) => {
        onProgress(event.payload);
      });
    }

    const result = await invoke<WhisperTranscriptionResult>('transcribe_audio', {
      request: {
        input_path: request.inputPath,
        preset: request.preset,
        model: request.model,
        language: request.language,
        task: request.task,
        content_type: request.contentType || 'default',
      },
    });

    if (unlisten) unlisten();
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[IPC] Whisper transcription failed:', detail);
    throw new Error(detail);
  }
}


export interface LicenseInfo {
  is_valid: boolean;
  is_trial: boolean;
  purchase_date?: string | null;
  license_key?: string | null;
  features?: string[];
  limitations?: TrialLimitations;
  email: string | null;
  error?: string;
}

export interface TrialLimitations {
  max_duration_seconds: number;
  allowed_stems: string[];
  output_format: string;
  engine: string;
  batch_allowed: boolean;
  fx_allowed: boolean;
  vst_allowed: boolean;
  high_quality_preview: boolean;
  max_free_splits?: number;
}

export interface TrialFreeTierStatus {
  is_trial: boolean;
  completed_splits: number;
  max_free_splits: number;
  free_splits_remaining: number;
  free_tier_exhausted: boolean;
  cooldown_active: boolean;
  remaining_seconds: number;
  current_cooldown_minutes: number;
  next_cooldown_minutes: number;
}

export async function getTrialFreeTierStatus(): Promise<TrialFreeTierStatus> {
  try {
    return await invoke<TrialFreeTierStatus>('get_trial_cooldown_status');
  } catch (error) {
    console.error('Failed to get free tier status:', error);
    return {
      is_trial: true,
      completed_splits: 0,
      max_free_splits: 1,
      free_splits_remaining: 1,
      free_tier_exhausted: false,
      cooldown_active: false,
      remaining_seconds: 0,
      current_cooldown_minutes: 0,
      next_cooldown_minutes: 0,
    };
  }
}

export interface AuthProfile {
  username: string;
  email: string;
  created_at?: string | null;
}

export interface AuthResult {
  success: boolean;
  profile: AuthProfile | null;
  onboarding_email_sent: boolean;
  message: string;
  error?: string | null;
}

export async function getLicenseStatus(): Promise<LicenseInfo> {
  try {
    return await invoke<LicenseInfo>('get_license_status');
  } catch (error) {
    console.error('Failed to get license status:', error);
    return { is_valid: false, is_trial: true, email: null };
  }
}

export async function activateLicense(licenseKey: string, email: string): Promise<LicenseInfo> {
  try {
    return await invoke<LicenseInfo>('activate_license', { licenseKey, email });
  } catch (error) {
    console.error('Failed to activate license:', error);
    return { is_valid: false, is_trial: true, email: null, error: String(error) };
  }
}

export async function deactivateLicense(): Promise<LicenseInfo> {
  try {
    return await invoke<LicenseInfo>('deactivate_license');
  } catch (error) {
    console.error('Failed to deactivate license:', error);
    return { is_valid: false, is_trial: true, email: null };
  }
}

export async function registerFreeUser(username: string, email: string, password: string): Promise<AuthResult> {
  try {
    return await invoke<AuthResult>('register_free_user', { username, email, password });
  } catch (error) {
    console.error('Failed to register free user:', error);
    return {
      success: false,
      profile: null,
      onboarding_email_sent: false,
      message: 'Signup failed',
      error: String(error),
    };
  }
}

export async function loginFreeUser(identifier: string, password: string): Promise<AuthResult> {
  try {
    return await invoke<AuthResult>('login_free_user', { identifier, password });
  } catch (error) {
    console.error('Failed to login free user:', error);
    return {
      success: false,
      profile: null,
      onboarding_email_sent: false,
      message: 'Login failed',
      error: String(error),
    };
  }
}

export async function getFreeUserSession(): Promise<AuthResult> {
  try {
    return await invoke<AuthResult>('get_free_user_session');
  } catch (error) {
    console.error('Failed to get free user session:', error);
    return {
      success: false,
      profile: null,
      onboarding_email_sent: false,
      message: 'No active session',
      error: String(error),
    };
  }
}

export async function logoutFreeUser(): Promise<AuthResult> {
  try {
    return await invoke<AuthResult>('logout_free_user');
  } catch (error) {
    console.error('Failed to logout free user:', error);
    return {
      success: false,
      profile: null,
      onboarding_email_sent: false,
      message: 'Logout failed',
      error: String(error),
    };
  }
}

export function isPro(license: LicenseInfo | null): boolean {
  return !!license?.is_valid && !license?.is_trial;
}

export function isTrial(license: LicenseInfo | null): boolean {
  return license?.is_trial !== false;
}

export function hasFeature(license: LicenseInfo | null, feature: string): boolean {
  if (isPro(license)) return true;
  if (feature === '2-stem') return true;
  return false;
}

export interface VstAccessResult {
  allowed: boolean;
  owned: boolean;
  reason?: string | null;
  previews_remaining: number;
  applies_remaining: number;
}

export interface VstPluginStatus {
  plugin_id: string;
  owned: boolean;
  previews_used: number;
  applies_used: number;
  previews_remaining: number;
  applies_remaining: number;
}

export interface VstEntitlementsStatus {
  plugins: VstPluginStatus[];
  pro_unlocked: boolean;
  last_sync?: string | null;
}

export async function getVstEntitlementsStatus(): Promise<VstEntitlementsStatus> {
  try {
    return await invoke<VstEntitlementsStatus>('get_vst_entitlements_status');
  } catch (error) {
    console.error('Failed to get VST entitlements status:', error);
    return { plugins: [], pro_unlocked: false, last_sync: null };
  }
}

export async function checkVstAccess(
  pluginId: string,
  action: 'preview' | 'apply'
): Promise<VstAccessResult> {
  try {
    return await invoke<VstAccessResult>('check_vst_access', { pluginId, action });
  } catch (error) {
    console.error('Failed to check VST access:', error);
    return {
      allowed: false,
      owned: false,
      reason: String(error),
      previews_remaining: 0,
      applies_remaining: 0,
    };
  }
}

export async function syncVstEntitlementsFromServer(email: string): Promise<VstEntitlementsStatus> {
  return invoke<VstEntitlementsStatus>('sync_vst_entitlements_from_server', { email });
}

export async function recordVstUsage(
  pluginId: string,
  action: 'preview' | 'apply'
): Promise<VstEntitlementsStatus> {
  return invoke<VstEntitlementsStatus>('record_vst_usage', { pluginId, action });
}

