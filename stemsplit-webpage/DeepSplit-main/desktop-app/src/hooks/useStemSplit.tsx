/**
 * React Hook for Stem Split Integration
 * Provides state management and error handling for the stem split process
 */

import { useState, useCallback, useRef } from 'react';
import {
  startStemSplit,
  cancelStemSplit,
  getSeparatorStatus,
  onStemSplitProgress,
  ProgressEvent,
  SeparationResult,
} from '../lib/tauri-bridge';

/**
 * Stem split status enum
 */
export enum StemSplitStatus {
  IDLE = 'idle',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ERROR = 'error',
}

/**
 * Hook state interface
 */
export interface UseStemSplitState {
  status: StemSplitStatus;
  progress: ProgressEvent | null;
  result: SeparationResult | null;
  error: Error | null;
  isProcessing: boolean;
}

/**
 * Hook return interface
 */
export interface UseStemSplitReturn extends UseStemSplitState {
  startSeparation: (
    filePath: string,
    options?: {
      outputDir?: string;
      format?: 'wav' | 'mp3';
      bitrate?: number;
      applyEffects?: boolean;
      engine?: string;
      stems?: number;
      passes?: number;
    }
  ) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  progressPercent: number;
}

/**
 * Main hook for managing stem split operations
 */
export function useStemSplit(): UseStemSplitReturn {
  const [status, setStatus] = useState<StemSplitStatus>(StemSplitStatus.IDLE);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [result, setResult] = useState<SeparationResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  /**
   * Handle incoming progress events
   */
  const handleProgress = useCallback((event: ProgressEvent) => {
    console.log(`[Progress] ${event.step}/${event.total_steps}: ${event.message}`);
    setProgress(event);

    // If progress reaches 100%, avoid setting COMPLETED status here
    // We wait for the actual command promise to resolve with the result object
    // This prevents race conditions where UI tries to access result before it's set
    // if (event.progress_percent >= 100) {
    //   setStatus(StemSplitStatus.COMPLETED);
    // }
  }, []);

  /**
   * Start stem separation process
   */
  const startSeparation = useCallback(
    async (
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
      }
    ) => {
      try {
        // Reset previous state
        setError(null);
        setResult(null);
        setProgress(null);
        setStatus(StemSplitStatus.PROCESSING);

        // Set up progress listener
        unlistenRef.current = await onStemSplitProgress(handleProgress);

        // Start separation with options
        const separationResult = await startStemSplit(filePath, options);

        setResult(separationResult);
        setStatus(StemSplitStatus.COMPLETED);
        console.log('[useStemSplit] Separation completed successfully', separationResult);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setStatus(StemSplitStatus.ERROR);
        console.error('[useStemSplit] Separation failed:', error);
      } finally {
        // Clean up listener
        if (unlistenRef.current) {
          unlistenRef.current();
          unlistenRef.current = null;
        }
      }
    },
    [handleProgress]
  );

  /**
   * Cancel ongoing separation
   */
  const cancel = useCallback(async () => {
    try {
      const currentStatus = await getSeparatorStatus();
      if (currentStatus === 'processing') {
        await cancelStemSplit();
        setStatus(StemSplitStatus.CANCELLED);
        console.log('[useStemSplit] Separation cancelled');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('[useStemSplit] Cancellation failed:', error);
    }
  }, []);

  /**
   * Reset hook state
   */
  const reset = useCallback(() => {
    setStatus(StemSplitStatus.IDLE);
    setProgress(null);
    setResult(null);
    setError(null);

    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  return {
    status,
    progress,
    result,
    error,
    isProcessing: status === StemSplitStatus.PROCESSING,
    startSeparation,
    cancel,
    reset,
    progressPercent: progress?.progress_percent ?? 0,
  };
}

/**
 * Example React component using the hook
 */
export function StemSplitController() {
  const {
    status,
    progress,
    result,
    error,
    isProcessing,
    progressPercent,
    startSeparation,
    cancel,
    reset,
  } = useStemSplit();

  const handleFileSelect = useCallback(async () => {
    // In a real app, use Tauri file picker
    const filePath = '/path/to/audio/file.wav';
    await startSeparation(filePath);
  }, [startSeparation]);

  return (
    <div className="stem-split-controller">
      {/* Status Display */}
      <div className="status-section">
        <p>Status: {status}</p>
        {error && <p className="error">Error: {error.message}</p>}
      </div>

      {/* Progress Display */}
      {isProcessing && progress && (
        <div className="progress-section">
          <p>
            {progress.step}/{progress.total_steps}: {progress.message}
          </p>
          <progress
            className="progress-bar"
            value={progressPercent}
            max={100}
          />
          <p>{progressPercent}%</p>
        </div>
      )}

      {/* Results Display */}
      {result && status === StemSplitStatus.COMPLETED && (
        <div className="results-section">
          <h3>Separation Complete!</h3>
          <p>Output Directory: {result.output_directory}</p>
          <p>Duration: {result.process_duration_seconds.toFixed(2)}s</p>
          <ul>
            {Object.entries(result.stems).map(([stemName, stemInfo]) => (
              <li key={stemName}>
                {stemName}: {stemInfo.file_path} ({stemInfo.duration_seconds.toFixed(2)}s)
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Controls */}
      <div className="controls-section">
        <button
          onClick={handleFileSelect}
          disabled={isProcessing}
          className="btn-start"
        >
          Start Separation
        </button>

        {isProcessing && (
          <button onClick={cancel} className="btn-cancel">
            Cancel
          </button>
        )}

        {status !== StemSplitStatus.IDLE && (
          <button onClick={reset} className="btn-reset">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

export default useStemSplit;
