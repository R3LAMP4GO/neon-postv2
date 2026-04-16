/**
 * Video Engine Bridge Types
 *
 * Types for communicating with the Python video processing engine
 * (neon-cut) via JSON over stdin/stdout. The bridge spawns a Python
 * subprocess and exchanges BridgeCommand / BridgeResponse messages.
 */

// ── Bridge Protocol ──

/** Commands sent to the Python video engine over stdin */
export interface BridgeCommand {
  /** Unique request ID for correlating responses */
  id: string;
  /** The action the engine should perform */
  action: BridgeAction;
  /** Action-specific payload */
  payload: Record<string, unknown>;
}

/** Supported bridge actions */
export type BridgeAction =
  | 'process_video'
  | 'transcribe'
  | 'apply_effects'
  | 'generate_captions'
  | 'export'
  | 'probe'
  | 'health_check';

/** Responses received from the Python video engine over stdout */
export interface BridgeResponse {
  /** Correlates to the BridgeCommand.id */
  id: string;
  /** Whether the command completed successfully */
  success: boolean;
  /** Action that was performed */
  action: BridgeAction;
  /** Result data (action-specific) */
  data?: Record<string, unknown>;
  /** Error message on failure */
  error?: string;
  /** Execution time in milliseconds */
  durationMs?: number;
}

// ── Video Processing ──

/** Video processing options passed to process_video action */
export interface VideoProcessOptions {
  /** Absolute path to the input video file */
  inputPath: string;
  /** Absolute path for the output video file */
  outputPath: string;
  /** Target resolution (e.g. "1080x1920" for vertical, "1920x1080" for landscape) */
  resolution?: string;
  /** Target FPS */
  fps?: number;
  /** Video codec (e.g. "h264", "h265") */
  codec?: string;
  /** Bitrate (e.g. "5M") */
  bitrate?: string;
  /** Audio codec (e.g. "aac") */
  audioCodec?: string;
  /** Audio bitrate (e.g. "192k") */
  audioBitrate?: string;
  /** Trim start time in seconds */
  trimStart?: number;
  /** Trim end time in seconds */
  trimEnd?: number;
  /** Effects to apply during processing */
  effects?: VideoEffect[];
  /** Caption overlay settings */
  captions?: CaptionOptions;
}

/** A single video effect descriptor */
export interface VideoEffect {
  /** Effect type identifier */
  type: string;
  /** Effect parameters */
  params: Record<string, unknown>;
  /** Start time in seconds (relative to trimmed video) */
  startTime?: number;
  /** End time in seconds */
  endTime?: number;
}

/** Caption overlay configuration */
export interface CaptionOptions {
  /** Path to SRT/VTT subtitle file */
  subtitlePath?: string;
  /** Font family */
  fontFamily?: string;
  /** Font size in pixels */
  fontSize?: number;
  /** Font color (hex) */
  fontColor?: string;
  /** Background color (hex with alpha) */
  backgroundColor?: string;
  /** Position: top, center, bottom */
  position?: 'top' | 'center' | 'bottom';
  /** Stroke/outline width */
  strokeWidth?: number;
  /** Stroke color (hex) */
  strokeColor?: string;
}

// ── Transcription ──

/** Options for audio/video transcription */
export interface TranscribeOptions {
  /** Absolute path to the media file */
  inputPath: string;
  /** Language code (e.g. "en", "es") — auto-detected if omitted */
  language?: string;
  /** Whisper model size: tiny, base, small, medium, large */
  modelSize?: WhisperModelSize;
  /** Output format for the transcript */
  outputFormat?: TranscriptFormat;
  /** Absolute path for the output transcript file */
  outputPath?: string;
  /** Whether to include word-level timestamps */
  wordTimestamps?: boolean;
}

/** Whisper model sizes */
export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large';

/** Supported transcript output formats */
export type TranscriptFormat = 'srt' | 'vtt' | 'json' | 'txt';

/** A single transcript segment */
export interface TranscriptSegment {
  /** Segment start time in seconds */
  start: number;
  /** Segment end time in seconds */
  end: number;
  /** Transcribed text */
  text: string;
  /** Word-level timestamps (if requested) */
  words?: TranscriptWord[];
}

/** A single word with timing info */
export interface TranscriptWord {
  /** Word start time in seconds */
  start: number;
  /** Word end time in seconds */
  end: number;
  /** The word text */
  word: string;
  /** Confidence score (0–1) */
  confidence?: number;
}

/** Full transcription result */
export interface TranscriptionResult {
  /** Detected or specified language */
  language: string;
  /** Total duration of the media in seconds */
  duration: number;
  /** Transcript segments */
  segments: TranscriptSegment[];
  /** Full text (concatenated segments) */
  text: string;
  /** Path to the written output file (if outputPath was provided) */
  outputPath?: string;
}

// ── Video Probe ──

/** Result from probing a video file's metadata */
export interface VideoProbeResult {
  /** Duration in seconds */
  duration: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Frame rate */
  fps: number;
  /** Video codec name */
  videoCodec: string;
  /** Audio codec name */
  audioCodec?: string;
  /** File size in bytes */
  fileSize: number;
  /** Container format */
  format: string;
  /** Bitrate in bits per second */
  bitrate: number;
}

// ── Engine Status ──

/** Health check result from the Python engine */
export interface EngineHealthResult {
  /** Whether the engine is operational */
  healthy: boolean;
  /** Python version */
  pythonVersion: string;
  /** Installed engine version */
  engineVersion: string;
  /** Available features/dependencies */
  features: {
    ffmpeg: boolean;
    whisper: boolean;
    torch: boolean;
  };
}

// ── Bridge State ──

/** Current state of the bridge subprocess */
export type BridgeState = 'idle' | 'starting' | 'ready' | 'busy' | 'error' | 'stopped';

/** Event emitted by the bridge for progress tracking */
export interface BridgeProgressEvent {
  /** Command ID this progress is for */
  commandId: string;
  /** Progress percentage (0–100) */
  percent: number;
  /** Current stage description */
  stage: string;
  /** Estimated time remaining in seconds */
  etaSeconds?: number;
}
