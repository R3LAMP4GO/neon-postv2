/**
 * Video Processing Pipeline
 *
 * High-level wrapper around the video engine bridge for processing
 * videos. Handles bridge lifecycle, sends process_video commands,
 * and converts responses into typed results.
 */

import { VideoBridge, isEngineAvailable, resolveEnginePath } from './bridge';
import type {
  BridgeResponse,
  VideoProcessOptions,
  VideoProbeResult,
  EngineHealthResult,
  BridgeProgressEvent,
} from './types';

const LOG_PREFIX = '[video-pipeline]';

/** Options for pipeline initialization */
export interface PipelineOptions {
  /** Override path to the effect_engine directory */
  enginePath?: string;
  /** Override path to the Python binary */
  pythonPath?: string;
  /** Progress callback for long-running operations */
  onProgress?: (event: BridgeProgressEvent) => void;
}

/** Result of a video processing operation */
export interface ProcessResult {
  success: boolean;
  /** Path to the output video file */
  outputPath?: string;
  /** Duration of the output in seconds */
  durationSeconds?: number;
  /** Processing time in milliseconds */
  processingTimeMs?: number;
  /** Error message on failure */
  error?: string;
}

/**
 * Process a video file through the engine pipeline.
 *
 * This is the main entry point for video processing. It:
 * 1. Checks that the engine is available
 * 2. Starts a bridge subprocess (if needed)
 * 3. Sends the process_video command
 * 4. Returns the result and shuts down the bridge
 *
 * @param options - Video processing options
 * @param pipelineOpts - Pipeline configuration
 * @returns Processing result
 */
export async function processVideo(
  options: VideoProcessOptions,
  pipelineOpts: PipelineOptions = {}
): Promise<ProcessResult> {
  const enginePath = resolveEnginePath(pipelineOpts.enginePath);

  if (!enginePath) {
    return {
      success: false,
      error: 'Video engine not available. The effect_engine/ directory was not found.',
    };
  }

  const bridge = new VideoBridge(enginePath, pipelineOpts.pythonPath);

  if (pipelineOpts.onProgress) {
    bridge.on('progress', pipelineOpts.onProgress);
  }

  try {
    console.log(`${LOG_PREFIX} Starting bridge for video processing...`);
    await bridge.start();

    const response = await bridge.send(
      'process_video',
      options as unknown as Record<string, unknown>,
      // Long timeout for video processing (10 minutes)
      600_000
    );

    return bridgeResponseToProcessResult(response, options.outputPath);
  } catch (err) {
    console.error(`${LOG_PREFIX} Processing failed:`, err);
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
 * Probe a video file to get its metadata (duration, resolution, etc.)
 * without processing it.
 */
export async function probeVideo(
  inputPath: string,
  pipelineOpts: PipelineOptions = {}
): Promise<VideoProbeResult | null> {
  const enginePath = resolveEnginePath(pipelineOpts.enginePath);
  if (!enginePath) return null;

  const bridge = new VideoBridge(enginePath, pipelineOpts.pythonPath);

  try {
    await bridge.start();
    const response = await bridge.send('probe', { inputPath });

    if (!response.success || !response.data) return null;

    return response.data as unknown as VideoProbeResult;
  } catch (err) {
    console.error(`${LOG_PREFIX} Probe failed:`, err);
    return null;
  } finally {
    await bridge.stop().catch(() => {});
  }
}

/**
 * Check the health of the video engine.
 * Returns null if the engine is not available.
 */
export async function checkEngineHealth(
  pipelineOpts: PipelineOptions = {}
): Promise<EngineHealthResult | null> {
  const enginePath = resolveEnginePath(pipelineOpts.enginePath);
  if (!enginePath) return null;

  const bridge = new VideoBridge(enginePath, pipelineOpts.pythonPath);

  try {
    await bridge.start();
    const response = await bridge.send('health_check', {});

    if (!response.success || !response.data) return null;

    return response.data as unknown as EngineHealthResult;
  } catch (err) {
    console.error(`${LOG_PREFIX} Health check failed:`, err);
    return null;
  } finally {
    await bridge.stop().catch(() => {});
  }
}

/**
 * Check whether the video processing pipeline is available.
 * This is a lightweight check that only verifies the engine directory
 * exists (no subprocess is started).
 */
export function isPipelineAvailable(enginePath?: string): boolean {
  return isEngineAvailable(enginePath);
}

// ── Internal ──

function bridgeResponseToProcessResult(
  response: BridgeResponse,
  outputPath: string
): ProcessResult {
  if (!response.success) {
    return {
      success: false,
      error: response.error ?? 'Unknown processing error',
      processingTimeMs: response.durationMs,
    };
  }

  return {
    success: true,
    outputPath: (response.data?.['outputPath'] as string) ?? outputPath,
    durationSeconds: response.data?.['duration'] as number | undefined,
    processingTimeMs: response.durationMs,
  };
}
