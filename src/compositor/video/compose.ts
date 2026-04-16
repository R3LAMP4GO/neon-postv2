import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { CANVAS_DIMENSIONS } from '../types';
import type { CanvasFormat } from '../types';

// ---------------------------------------------------------------------------
// Video compositor — FFmpeg pipeline
//
// Takes a source video + rendered overlay frame PNG → branded MP4.
//
// Pipeline:
//   1. ffprobe source video to get dimensions
//   2. Scale/crop source video to fit top portion of canvas
//   3. Pad to full canvas size (black fill for bottom)
//   4. Overlay the transparent branded frame PNG
//   5. Output as H.264 MP4
// ---------------------------------------------------------------------------

export interface ComposeOptions {
  /** Path to the source video file. */
  videoPath: string;
  /** Path to the pre-rendered overlay PNG (from renderVideoFrame). */
  overlayPath: string;
  /** Path for the output branded MP4. */
  outputPath: string;
  /** Canvas format — determines output dimensions. Default: 'portrait' (1080x1350). */
  format?: CanvasFormat;
  /** Split ratio — how much of the canvas the video occupies. Default: 0.50. */
  splitRatio?: number;
  /** CRF quality (0=lossless, 23=default, 51=worst). Default: 18. */
  crf?: number;
  /** FFmpeg preset (ultrafast → veryslow). Default: 'fast'. */
  preset?: string;
  /** Optional trim start time in seconds. */
  trimStart?: number;
  /** Optional trim end time in seconds. */
  trimEnd?: number;
  /** Path to ffmpeg binary. Auto-detected if omitted. */
  ffmpegPath?: string;
  /** Path to ffprobe binary. Auto-detected if omitted. */
  ffprobePath?: string;
}

export interface ComposeResult {
  /** Whether the composition succeeded. */
  success: boolean;
  /** Path to the output file (same as outputPath). */
  outputPath: string;
  /** Output dimensions. */
  width: number;
  height: number;
  /** Duration in seconds (if available). */
  duration?: number;
  /** Error message on failure. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Probe — get video dimensions and duration via ffprobe
// ---------------------------------------------------------------------------

interface ProbeResult {
  width: number;
  height: number;
  duration: number;
}

function probeVideo(videoPath: string, ffprobePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      videoPath,
    ];

    const proc = spawn(ffprobePath, args);
    const chunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('error', (err) => reject(new Error(`ffprobe failed to start: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}`));
        return;
      }

      try {
        const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        const videoStream = json.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        resolve({
          width: videoStream.width,
          height: videoStream.height,
          duration: parseFloat(json.format?.duration ?? videoStream.duration ?? '0'),
        });
      } catch (err) {
        reject(new Error(`Failed to parse ffprobe output: ${(err as Error).message}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Compose — FFmpeg filter_complex pipeline
// ---------------------------------------------------------------------------

/**
 * Composites a source video with a branded overlay PNG into a final MP4.
 *
 * The source video is scaled/cropped to fill the top portion of the canvas
 * (top-aligned, preserving aspect ratio). The remainder is black. The
 * overlay PNG (with transparent top half) is composited on top.
 */
export async function composeVideo(options: ComposeOptions): Promise<ComposeResult> {
  const {
    videoPath,
    overlayPath,
    outputPath,
    format = 'portrait',
    splitRatio = 0.50,
    crf = 18,
    preset = 'fast',
    trimStart,
    trimEnd,
    ffmpegPath = findBinary('ffmpeg'),
    ffprobePath = findBinary('ffprobe'),
  } = options;

  // Validate inputs exist
  if (!fs.existsSync(videoPath)) {
    return { success: false, outputPath, width: 0, height: 0, error: `Video not found: ${videoPath}` };
  }
  if (!fs.existsSync(overlayPath)) {
    return { success: false, outputPath, width: 0, height: 0, error: `Overlay not found: ${overlayPath}` };
  }

  const dims = CANVAS_DIMENSIONS[format];
  const videoZoneH = Math.round(dims.height * splitRatio);

  // Probe source video
  let probe: ProbeResult;
  try {
    probe = await probeVideo(videoPath, ffprobePath);
  } catch (err) {
    return { success: false, outputPath, width: 0, height: 0, error: (err as Error).message };
  }

  // Build filter_complex:
  //   [0:v] → cover-fit scale to fill video zone → crop to exact zone → pad to full canvas
  //         → overlay the branded PNG frame
  //
  // Cover-fit: scale so BOTH dimensions are at least the target (increase mode),
  // then crop to exact zone size. Top-aligned = crop from center-x, top-y.
  const filter = [
    // Cover-fit scale: increase until both dims >= target
    `[0:v]scale=${dims.width}:${videoZoneH}:force_original_aspect_ratio=increase`,
    // Crop to exact video zone (centered horizontally, top-aligned vertically)
    `crop=${dims.width}:${videoZoneH}:(iw-${dims.width})/2:0`,
    // Pad to full canvas height — video at top, black fill below
    `pad=${dims.width}:${dims.height}:0:0:black[bg]`,
    // Overlay the branded frame PNG on top
    `[bg][1:v]overlay=0:0:format=auto[out]`,
  ].join(',');

  // Build ffmpeg args
  const args: string[] = [];

  // Input 0: source video
  if (trimStart !== undefined) args.push('-ss', String(trimStart));
  if (trimEnd !== undefined) args.push('-to', String(trimEnd));
  args.push('-i', videoPath);

  // Input 1: overlay PNG
  args.push('-i', overlayPath);

  // Filter
  args.push('-filter_complex', filter);
  args.push('-map', '[out]');

  // Copy audio from source (if present)
  args.push('-map', '0:a?');

  // Encoding settings
  args.push(
    '-c:v', 'libx264',
    '-crf', String(crf),
    '-preset', preset,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y', // overwrite output
    outputPath,
  );

  // Run ffmpeg
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args);
    const stderr: string[] = [];

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk.toString());
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        outputPath,
        width: dims.width,
        height: dims.height,
        error: `FFmpeg failed to start: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const lastLines = stderr.join('').split('\n').slice(-10).join('\n');
        resolve({
          success: false,
          outputPath,
          width: dims.width,
          height: dims.height,
          error: `FFmpeg exited with code ${code}:\n${lastLines}`,
        });
        return;
      }

      // Calculate duration
      let duration = probe.duration;
      if (trimStart !== undefined || trimEnd !== undefined) {
        const start = trimStart ?? 0;
        const end = trimEnd ?? probe.duration;
        duration = end - start;
      }

      resolve({
        success: true,
        outputPath,
        width: dims.width,
        height: dims.height,
        duration,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Binary path resolution
// ---------------------------------------------------------------------------

function findBinary(name: string): string {
  // Windows: check common locations
  if (os.platform() === 'win32') {
    const winPaths = [
      `C:\\Program Files\\FFmpeg\\bin\\${name}.exe`,
      `C:\\ffmpeg\\bin\\${name}.exe`,
      path.join(os.homedir(), 'ffmpeg', 'bin', `${name}.exe`),
      path.join(os.homedir(), 'scoop', 'shims', `${name}.exe`),
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  // Fallback: assume it's in PATH
  return name;
}
