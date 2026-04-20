/**
 * Unit tests for the rolling file logger (src/utils/file-logger.ts).
 *
 * Covers:
 *  - Writes a JSON-per-line entry with ts/scope/level/message/error
 *  - Creates logs directory if missing
 *  - Round-trips serialized Error with name/message/stack
 *  - Serializes domain-specific properties (statusCode, url) from custom errors
 *  - 7-day retention: prunes files older than cutoff on first write per day
 *  - Never throws: swallows failures (readonly dir, etc.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  logError,
  logInfo,
  getLogFilePath,
  setLogBaseDir,
  _resetLoggerState,
} from '../../src/utils/file-logger';

let tmpDir: string;

beforeEach(() => {
  _resetLoggerState();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-log-test-'));
  setLogBaseDir(tmpDir);
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
  setLogBaseDir(null);
});

function readAllLines(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

describe('logError', () => {
  it('writes a JSON line with ts/scope/level/message', () => {
    logError('test-scope', 'something broke');
    const file = getLogFilePath('test-scope');
    const lines = readAllLines(file);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.scope).toBe('test-scope');
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('something broke');
    expect(typeof entry.ts).toBe('string');
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('serializes Error with name/message/stack', () => {
    const err = new Error('oh no');
    logError('test-scope', 'failed', err);
    const lines = readAllLines(getLogFilePath('test-scope'));
    const entry = JSON.parse(lines[0]);
    expect(entry.error.name).toBe('Error');
    expect(entry.error.message).toBe('oh no');
    expect(typeof entry.error.stack).toBe('string');
  });

  it('preserves statusCode + url on domain errors', () => {
    class CustomErr extends Error {
      statusCode?: number;
      url?: string;
      constructor(msg: string) {
        super(msg);
        this.name = 'CustomErr';
      }
    }
    const e = new CustomErr('403 forbidden');
    e.statusCode = 403;
    e.url = 'https://wsj.com';
    logError('test-scope', 'paywall', e);
    const entry = JSON.parse(readAllLines(getLogFilePath('test-scope'))[0]);
    expect(entry.error.statusCode).toBe(403);
    expect(entry.error.url).toBe('https://wsj.com');
  });

  it('includes meta object', () => {
    logError('test-scope', 'item failed', undefined, { itemUrl: 'https://a.com/1', retry: 2 });
    const entry = JSON.parse(readAllLines(getLogFilePath('test-scope'))[0]);
    expect(entry.meta).toEqual({ itemUrl: 'https://a.com/1', retry: 2 });
  });

  it('appends multiple entries to the same file', () => {
    logError('test-scope', 'first');
    logError('test-scope', 'second');
    logError('test-scope', 'third');
    const lines = readAllLines(getLogFilePath('test-scope'));
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).message).toBe('first');
    expect(JSON.parse(lines[2]).message).toBe('third');
  });

  it('creates the logs directory if missing', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    logError('test-scope', 'creates dir');
    expect(fs.existsSync(tmpDir)).toBe(true);
    expect(readAllLines(getLogFilePath('test-scope'))).toHaveLength(1);
  });

  it('does not throw when the directory is unwritable', () => {
    // Point logger at a path that cannot exist as a directory (null byte on POSIX)
    setLogBaseDir('/dev/null/not-a-dir');
    expect(() => logError('test-scope', 'boom')).not.toThrow();
  });
});

describe('daily rotation + 7-day retention', () => {
  it('different days write to different files (YYYY-MM-DD in filename)', () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    expect(getLogFilePath('s', today)).not.toBe(getLogFilePath('s', yesterday));
  });

  it('prunes files older than 7 days on first write per process', () => {
    // Seed: one fresh file, one 6-day-old file, one 8-day-old file (stale)
    const keep1 = path.join(tmpDir, 'test-2026-04-20.log');
    const keep2 = path.join(tmpDir, 'test-2026-04-14.log'); // 6 days old
    const stale = path.join(tmpDir, 'test-2026-04-10.log'); // 10 days old

    fs.writeFileSync(keep1, 'keep1\n');
    fs.writeFileSync(keep2, 'keep2\n');
    fs.writeFileSync(stale, 'stale\n');

    const now = Date.now();
    fs.utimesSync(keep1, new Date(now), new Date(now));
    fs.utimesSync(keep2, new Date(now - 6 * 24 * 60 * 60 * 1000), new Date(now - 6 * 24 * 60 * 60 * 1000));
    fs.utimesSync(stale, new Date(now - 10 * 24 * 60 * 60 * 1000), new Date(now - 10 * 24 * 60 * 60 * 1000));

    // Unrelated scope file — must NOT be pruned by the 'test' scope
    const unrelated = path.join(tmpDir, 'other-2026-01-01.log');
    fs.writeFileSync(unrelated, 'unrelated\n');
    fs.utimesSync(unrelated, new Date(now - 100 * 24 * 60 * 60 * 1000), new Date(now - 100 * 24 * 60 * 60 * 1000));

    logError('test', 'trigger prune');

    expect(fs.existsSync(keep1)).toBe(true);
    expect(fs.existsSync(keep2)).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it('only prunes once per scope per day (second call is a no-op)', () => {
    const stale = path.join(tmpDir, 'scope-2026-01-01.log');
    fs.writeFileSync(stale, 'stale\n');
    fs.utimesSync(stale, new Date(Date.now() - 30 * 86_400_000), new Date(Date.now() - 30 * 86_400_000));

    logError('scope', 'first'); // prunes
    expect(fs.existsSync(stale)).toBe(false);

    // Re-create a stale file and log again: must NOT prune this one (already pruned today)
    fs.writeFileSync(stale, 'stale2\n');
    fs.utimesSync(stale, new Date(Date.now() - 30 * 86_400_000), new Date(Date.now() - 30 * 86_400_000));
    logError('scope', 'second');
    expect(fs.existsSync(stale)).toBe(true);
  });
});

describe('logInfo', () => {
  it('writes a level=info line', () => {
    logInfo('test-scope', 'ok', { n: 1 });
    const entry = JSON.parse(readAllLines(getLogFilePath('test-scope'))[0]);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('ok');
    expect(entry.meta).toEqual({ n: 1 });
  });
});
