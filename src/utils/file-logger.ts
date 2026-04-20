/**
 * Rolling disk error logger — zero-dependency, Electron-aware.
 *
 * - Writes one JSON object per line to `<logsDir>/<scope>-YYYY-MM-DD.log`.
 * - Logs directory resolves via Electron's `app.getPath('logs')` when available
 *   (idiomatic per-platform location); falls back to `os.tmpdir()/neon-post-logs`
 *   for non-Electron contexts (unit tests).
 * - On the first write per day per process, prunes files matching the scope that
 *   are older than RETENTION_DAYS (7).
 * - All I/O is wrapped in try/catch — a failed log write must never crash the
 *   caller. Silent on all failures.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RETENTION_DAYS = 7;

// One-time-per-day prune marker per scope (avoid scanning dir on every log line).
const prunedScopes: Record<string, string> = {};

let cachedBaseDir: string | null = null;

/**
 * Resolve the base logs directory. In the Electron main process this calls
 * `app.getPath('logs')` dynamically so we don't hard-depend on electron at
 * module load (renderer / tests import this too).
 */
function resolveBaseDir(): string {
  if (cachedBaseDir) return cachedBaseDir;
  try {
    // Lazy-require so non-Electron callers don't blow up
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { getPath?: (k: string) => string } };
    const dir = electron.app?.getPath?.('logs');
    if (dir) {
      cachedBaseDir = dir;
      return dir;
    }
  } catch {
    // Not running under Electron — fall through to tmpdir
  }
  cachedBaseDir = path.join(os.tmpdir(), 'neon-post-logs');
  return cachedBaseDir;
}

/** Override the base directory (tests only). Pass null to restore Electron lookup. */
export function setLogBaseDir(dir: string | null): void {
  cachedBaseDir = dir;
}

function dateStr(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLogFilePath(scope: string, date: Date = new Date()): string {
  const base = resolveBaseDir();
  return path.join(base, `${scope}-${dateStr(date)}.log`);
}

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* noop — writeFile will re-error if genuinely unwritable */
  }
}

function pruneOldFiles(scope: string): void {
  const today = dateStr(new Date());
  if (prunedScopes[scope] === today) return; // already pruned today
  prunedScopes[scope] = today;

  const base = resolveBaseDir();
  try {
    const files = fs.readdirSync(base);
    const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const prefix = `${scope}-`;
    for (const f of files) {
      if (!f.startsWith(prefix) || !f.endsWith('.log')) continue;
      const full = path.join(base, f);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoffMs) fs.unlinkSync(full);
      } catch {
        /* ignore individual file errors */
      }
    }
  } catch {
    /* dir missing / unreadable — next append will recreate */
  }
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  statusCode?: number;
  url?: string;
}

function serializeError(err: unknown): SerializedError | null {
  if (err == null) return null;
  if (err instanceof Error) {
    // Preserve any domain-specific extras (e.g. ArticleScrapeError.statusCode + url)
    const extra = err as unknown as Record<string, unknown>;
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(typeof extra.statusCode === 'number' ? { statusCode: extra.statusCode } : {}),
      ...(typeof extra.url === 'string' ? { url: extra.url } : {}),
    };
  }
  return { name: 'NonError', message: String(err) };
}

export function logError(
  scope: string,
  message: string,
  err?: unknown,
  meta?: Record<string, unknown>
): void {
  try {
    const base = resolveBaseDir();
    ensureDir(base);
    pruneOldFiles(scope);

    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        scope,
        level: 'error',
        message,
        error: serializeError(err),
        meta: meta ?? undefined,
      }) + '\n';

    fs.appendFileSync(getLogFilePath(scope), line, { encoding: 'utf8' });
  } catch {
    // Never let logger failures propagate
  }
}

export function logInfo(
  scope: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  try {
    const base = resolveBaseDir();
    ensureDir(base);
    pruneOldFiles(scope);

    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        scope,
        level: 'info',
        message,
        meta: meta ?? undefined,
      }) + '\n';

    fs.appendFileSync(getLogFilePath(scope), line, { encoding: 'utf8' });
  } catch {
    /* noop */
  }
}

/** Reset internal state — tests only. */
export function _resetLoggerState(): void {
  for (const k of Object.keys(prunedScopes)) delete prunedScopes[k];
  cachedBaseDir = null;
}
