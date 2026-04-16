/**
 * AssemblyAI transcription — Python CLI script as primary, Node fetch as fallback.
 *
 * Primary: shells out to scripts/transcribe.py (uses AssemblyAI Python SDK + Universal v3).
 *   Kept as CLI for future video editing capabilities (chapters, diarization, highlights).
 * Fallback: direct HTTP fetch to AssemblyAI REST API (for when python isn't available).
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { TranscriptionResult } from '../video/types.js';
import { SettingsManager } from '../../settings/index.js';
import { proxyFetch } from '../../utils/proxy-fetch';

const LOG_PREFIX = '[Transcription]';
const AAI_BASE = 'https://api.assemblyai.com/v2';

function getApiKey(): string {
  const key = (SettingsManager.get('assembly.apiKey') as string) || '';
  if (!key) {
    console.warn(`${LOG_PREFIX} No AssemblyAI API key found in settings (assembly.apiKey)`);
  }
  return key;
}

// ── Python CLI (primary) ──────────────────────────────────────────────

function getScriptPath(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, '..', '..', '..', 'scripts', 'transcribe.py');
}

/** Get the python command — 'python' on Windows, 'python3' elsewhere */
function getPythonCmd(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

interface CLIResult {
  text: string;
  language?: string;
  duration?: number;
  model?: string;
  segments?: Array<{ start: number; end: number; text: string; speaker?: string }>;
  chapters?: Array<{ start: number; end: number; headline: string; summary: string; gist: string }>;
  error?: string;
}

async function transcribeViaCLI(filePathOrUrl: string): Promise<TranscriptionResult> {
  const { execFile } = await import('node:child_process');
  const scriptPath = getScriptPath();
  const apiKey = getApiKey();
  const pythonCmd = getPythonCmd();

  console.log(`${LOG_PREFIX} [CLI] Attempting transcription via ${pythonCmd} ${scriptPath}`);
  console.log(`${LOG_PREFIX} [CLI] Input: ${filePathOrUrl}`);
  console.log(`${LOG_PREFIX} [CLI] API key present: ${!!apiKey} (${apiKey.slice(0, 6)}...)`);

  const args = [scriptPath, filePathOrUrl];
  if (apiKey) args.push('--key', apiKey);

  const raw = await new Promise<string>((resolve, reject) => {
    execFile(
      pythonCmd,
      args,
      { timeout: 660_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as { code?: string }).code;
          if (code === 'ENOENT') {
            reject(new Error(`${pythonCmd} not found on this system`));
            return;
          }
          console.error(`${LOG_PREFIX} [CLI] stderr: ${stderr?.slice(0, 500)}`);
          // Script outputs JSON even on failure
          if (stdout.trim()) {
            resolve(stdout.trim());
            return;
          }
          reject(new Error(`transcribe.py failed: ${stderr?.slice(0, 300) ?? error.message}`));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });

  let parsed: CLIResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`transcribe.py returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  if (parsed.error) throw new Error(parsed.error);

  console.log(
    `${LOG_PREFIX} [CLI] Success (${parsed.model ?? 'v3'}, ${parsed.text.length} chars, ${parsed.duration?.toFixed(1) ?? '?'}s)`
  );

  return {
    language: parsed.language ?? 'en',
    duration: parsed.duration ?? 0,
    segments: (parsed.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    })),
    text: parsed.text,
  };
}

// ── Node fetch fallback ───────────────────────────────────────────────

interface AAITranscript {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text: string | null;
  error: string | null;
  audio_duration: number | null;
  language_code: string | null;
  utterances: Array<{ start: number; end: number; text: string; speaker: string }> | null;
  words: Array<{ start: number; end: number; text: string }> | null;
}

async function aaiFetch<T>(path: string, apiKey: string, options?: RequestInit): Promise<T> {
  const res = await proxyFetch(`${AAI_BASE}${path}`, {
    ...options,
    headers: {
      authorization: apiKey,
      'content-type': 'application/json',
      ...(options?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AssemblyAI API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function uploadFile(filePath: string, apiKey: string): Promise<string> {
  console.log(`${LOG_PREFIX} [HTTP] Uploading file: ${filePath}`);
  const fileStat = await stat(filePath);
  console.log(`${LOG_PREFIX} [HTTP] File size: ${(fileStat.size / 1024 / 1024).toFixed(1)}MB`);

  // Read the entire file into a buffer — works reliably in Electron
  const fileBuffer = readFileSync(filePath);

  const res = await proxyFetch(`${AAI_BASE}/upload`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream',
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { upload_url: string };
  console.log(`${LOG_PREFIX} [HTTP] Upload complete: ${data.upload_url.slice(0, 60)}...`);
  return data.upload_url;
}

async function transcribeViaHTTP(filePathOrUrl: string): Promise<TranscriptionResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('AssemblyAI API key not configured');

  console.log(`${LOG_PREFIX} [HTTP] Attempting transcription via REST API`);
  console.log(`${LOG_PREFIX} [HTTP] Input: ${filePathOrUrl}`);

  // If it's a local file, upload it first
  let audioUrl = filePathOrUrl;
  if (!filePathOrUrl.startsWith('http')) {
    audioUrl = await uploadFile(filePathOrUrl, apiKey);
  }

  // Submit transcription job with v3
  const job = await aaiFetch<AAITranscript>('/transcript', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: ['universal-2'],
      language_detection: true,
    }),
  });

  console.log(`${LOG_PREFIX} [HTTP] Job submitted: ${job.id} (status: ${job.status})`);

  // Poll (5s interval, 10min max)
  const maxWait = 600_000;
  const start = Date.now();
  let result = job;

  while (result.status !== 'completed' && result.status !== 'error' && Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 5_000));
    result = await aaiFetch<AAITranscript>(`/transcript/${job.id}`, apiKey);
    console.log(`${LOG_PREFIX} [HTTP] Poll: ${result.status} (${((Date.now() - start) / 1000).toFixed(0)}s)`);
  }

  if (result.status === 'error') throw new Error(`Transcription failed: ${result.error}`);
  if (result.status !== 'completed') throw new Error('Transcription timed out (10 min)');

  const segments: Array<{ start: number; end: number; text: string }> = [];

  if (result.utterances?.length) {
    for (const u of result.utterances) {
      segments.push({ start: u.start / 1000, end: u.end / 1000, text: u.text });
    }
  } else if (result.words?.length) {
    let chunk: string[] = [];
    let chunkStart = 0;
    for (const w of result.words) {
      if (!chunk.length) chunkStart = w.start / 1000;
      chunk.push(w.text);
      if (w.end / 1000 - chunkStart >= 10) {
        segments.push({ start: chunkStart, end: w.end / 1000, text: chunk.join(' ') });
        chunk = [];
      }
    }
    if (chunk.length) {
      segments.push({ start: chunkStart, end: result.words[result.words.length - 1].end / 1000, text: chunk.join(' ') });
    }
  } else {
    segments.push({ start: 0, end: result.audio_duration ?? 0, text: result.text ?? '' });
  }

  console.log(
    `${LOG_PREFIX} [HTTP] Success (v3, ${(result.text ?? '').length} chars, ${result.audio_duration?.toFixed(1) ?? '?'}s)`
  );

  return {
    language: result.language_code ?? 'en',
    duration: result.audio_duration ?? 0,
    segments,
    text: result.text ?? '',
  };
}

// ── OpenAI Whisper fallback ───────────────────────────────────────────

async function transcribeWithWhisper(filePath: string): Promise<TranscriptionResult> {
  console.log(`${LOG_PREFIX} [Whisper] Attempting fallback transcription`);
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OpenAI = (await import('openai')).default;

  const apiKey = SettingsManager.get('openai.apiKey') as string;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const openai = new OpenAI({ apiKey });
  const ext = path.extname(filePath).slice(1) || 'mp4';
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const file = new File([arrayBuffer], `audio.${ext}`, { type: `audio/${ext}` });

  const response = await openai.audio.transcriptions.create({ file, model: 'whisper-1' });

  console.log(`${LOG_PREFIX} [Whisper] Success (${response.text.length} chars)`);

  return {
    language: 'en',
    duration: 0,
    segments: [{ start: 0, end: 0, text: response.text }],
    text: response.text,
  };
}

// ── Public API ────────────────────────────────────────────────────────

/** Transcribe via Python CLI (primary). */
export { transcribeViaCLI as transcribeWithAssemblyAI };

/**
 * Transcribe a media file or URL.
 * Chain: Python CLI → Node HTTP → OpenAI Whisper.
 */
export async function transcribeContent(filePathOrUrl: string): Promise<TranscriptionResult> {
  console.log(`${LOG_PREFIX} ═══ Starting transcription: ${filePathOrUrl}`);

  const hasKey = !!getApiKey();
  if (!hasKey) {
    console.warn(`${LOG_PREFIX} No AssemblyAI key — skipping to fallbacks`);
  }

  const errors: string[] = [];

  // 1. Python CLI (primary — uses SDK, supports future video editing features)
  if (hasKey) {
    try {
      console.log(`${LOG_PREFIX} Trying: Python CLI script...`);
      return await transcribeViaCLI(filePathOrUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX} CLI failed: ${msg}`);
      errors.push(`CLI: ${msg}`);
    }

    // 2. Node HTTP fallback (no python needed)
    try {
      console.log(`${LOG_PREFIX} Trying: Node HTTP (direct API)...`);
      return await transcribeViaHTTP(filePathOrUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX} HTTP fallback failed: ${msg}`);
      errors.push(`HTTP: ${msg}`);
    }
  }

  // 3. OpenAI Whisper (last resort)
  if (SettingsManager.get('openai.apiKey')) {
    try {
      console.log(`${LOG_PREFIX} Trying: OpenAI Whisper...`);
      return await transcribeWithWhisper(filePathOrUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX} Whisper fallback failed: ${msg}`);
      errors.push(`Whisper: ${msg}`);
    }
  } else {
    errors.push('Whisper: no OpenAI key configured');
  }

  throw new Error(
    'Transcription failed — all methods exhausted. ' +
    errors.join(' | ')
  );
}
