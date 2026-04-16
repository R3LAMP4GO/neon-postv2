/**
 * Video Transcription
 *
 * High-level wrapper for audio/video transcription through the
 * Python video engine bridge. Uses Whisper (or compatible models)
 * on the Python side to produce timed transcripts.
 */

import { VideoBridge, resolveEnginePath, isEngineAvailable } from './bridge';
import type {
  TranscribeOptions,
  TranscriptionResult,
  BridgeProgressEvent,
  BridgeResponse,
} from './types';

const LOG_PREFIX = '[video-transcribe]';

/** Options for transcription pipeline */
export interface TranscribePipelineOptions {
  /** Override path to the effect_engine directory */
  enginePath?: string;
  /** Override path to the Python binary */
  pythonPath?: string;
  /** Timeout in milliseconds (default: 10 minutes) */
  timeoutMs?: number;
  /** Progress callback */
  onProgress?: (event: BridgeProgressEvent) => void;
}

/** Result of a transcription operation */
export interface TranscribeResult {
  success: boolean;
  /** Full transcription result on success */
  transcription?: TranscriptionResult;
  /** Error message on failure */
  error?: string;
  /** Processing time in milliseconds */
  processingTimeMs?: number;
}

/**
 * Transcribe an audio or video file to text with timestamps.
 *
 * This is the main entry point for transcription. It:
 * 1. Checks that the engine is available
 * 2. Starts a bridge subprocess
 * 3. Sends the transcribe command
 * 4. Returns structured transcript data
 *
 * @param options - Transcription options
 * @param pipelineOpts - Pipeline configuration
 * @returns Transcription result
 */
export async function transcribeVideo(
  options: TranscribeOptions,
  pipelineOpts: TranscribePipelineOptions = {}
): Promise<TranscribeResult> {
  const enginePath = resolveEnginePath(pipelineOpts.enginePath);

  if (!enginePath) {
    return {
      success: false,
      error: 'Video engine not available. The effect_engine/ directory was not found.',
    };
  }

  const bridge = new VideoBridge(enginePath, pipelineOpts.pythonPath);
  const timeoutMs = pipelineOpts.timeoutMs ?? 600_000;

  if (pipelineOpts.onProgress) {
    bridge.on('progress', pipelineOpts.onProgress);
  }

  try {
    console.log(`${LOG_PREFIX} Starting bridge for transcription of: ${options.inputPath}`);
    await bridge.start();

    const response = await bridge.send(
      'transcribe',
      options as unknown as Record<string, unknown>,
      timeoutMs
    );

    return bridgeResponseToTranscribeResult(response);
  } catch (err) {
    console.error(`${LOG_PREFIX} Transcription failed:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await bridge.stop().catch((err) => {
      console.warn(`${LOG_PREFIX} Bridge stop error:`, err);
    });
  }
}

/**
 * Generate captions (SRT/VTT) from a video file.
 *
 * Convenience wrapper around transcribeVideo that outputs to a subtitle file.
 *
 * @param inputPath - Path to the video/audio file
 * @param outputPath - Path where the subtitle file should be written
 * @param format - Subtitle format ('srt' or 'vtt')
 * @param pipelineOpts - Pipeline configuration
 */
export async function generateCaptions(
  inputPath: string,
  outputPath: string,
  format: 'srt' | 'vtt' = 'srt',
  pipelineOpts: TranscribePipelineOptions = {}
): Promise<TranscribeResult> {
  return transcribeVideo(
    {
      inputPath,
      outputPath,
      outputFormat: format,
      wordTimestamps: true,
    },
    pipelineOpts
  );
}

/**
 * Check whether transcription is available.
 * Lightweight check — only verifies the engine directory exists.
 */
export function isTranscriptionAvailable(enginePath?: string): boolean {
  return isEngineAvailable(enginePath);
}

// ── Internal ──

function bridgeResponseToTranscribeResult(response: BridgeResponse): TranscribeResult {
  if (!response.success) {
    return {
      success: false,
      error: response.error ?? 'Unknown transcription error',
      processingTimeMs: response.durationMs,
    };
  }

  if (!response.data) {
    return {
      success: false,
      error: 'Transcription returned no data',
      processingTimeMs: response.durationMs,
    };
  }

  return {
    success: true,
    transcription: response.data as unknown as TranscriptionResult,
    processingTimeMs: response.durationMs,
  };
}
