/**
 * Video Engine Bridge
 *
 * Manages a Python subprocess that runs the neon-cut video engine.
 * Communication happens via newline-delimited JSON over stdin/stdout.
 * The bridge is optional — it gracefully degrades if the effect_engine/
 * directory is not present.
 */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import type {
  BridgeCommand,
  BridgeResponse,
  BridgeAction,
  BridgeState,
  BridgeProgressEvent,
} from './types';

const LOG_PREFIX = '[video-bridge]';

/** Default timeout for bridge commands (2 minutes) */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Maximum time to wait for engine startup */
const STARTUP_TIMEOUT_MS = 30_000;

// ── Helpers ──

/** Generate a short random command ID */
function generateId(): string {
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Resolve the path to the effect_engine directory.
 * Returns null if the directory does not exist.
 */
export function resolveEnginePath(basePath?: string): string | null {
  const candidates = [
    basePath,
    path.join(process.cwd(), 'effect_engine'),
    path.join(process.cwd(), '..', 'neon-cut', 'effect_engine'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Check whether the video engine is available.
 * Returns true only if the effect_engine/ directory exists.
 */
export function isEngineAvailable(basePath?: string): boolean {
  return resolveEnginePath(basePath) !== null;
}

// ── Bridge Class ──

interface PendingRequest {
  resolve: (resp: BridgeResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * VideoBridge manages the lifecycle of the Python video engine subprocess.
 *
 * Usage:
 * ```ts
 * const bridge = new VideoBridge('/path/to/effect_engine');
 * await bridge.start();
 * const resp = await bridge.send('health_check', {});
 * await bridge.stop();
 * ```
 */
export class VideoBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: BridgeState = 'idle';
  private enginePath: string;
  private pythonPath: string;
  private pending = new Map<string, PendingRequest>();
  private buffer = '';

  constructor(enginePath: string, pythonPath?: string) {
    super();
    this.enginePath = enginePath;
    // Default to venv python, fall back to system python
    this.pythonPath = pythonPath ?? path.join(enginePath, 'venv', 'bin', 'python');

    // On Windows, adjust the venv path
    if (process.platform === 'win32' && !pythonPath) {
      this.pythonPath = path.join(enginePath, 'venv', 'Scripts', 'python.exe');
    }
  }

  /** Get the current bridge state */
  getState(): BridgeState {
    return this.state;
  }

  /**
   * Start the Python engine subprocess.
   * Resolves when the engine signals it is ready.
   */
  async start(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'starting') {
      throw new Error('Bridge is already starting');
    }

    this.state = 'starting';
    this.emit('stateChange', this.state);

    const entryPoint = path.join(this.enginePath, 'bridge_main.py');

    if (!fs.existsSync(entryPoint)) {
      this.state = 'error';
      this.emit('stateChange', this.state);
      throw new Error(`Engine entry point not found: ${entryPoint}. Run install first.`);
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.state = 'error';
        this.emit('stateChange', this.state);
        reject(new Error('Engine startup timed out'));
        this.stop().catch(() => {});
      }, STARTUP_TIMEOUT_MS);

      try {
        this.process = spawn(this.pythonPath, [entryPoint], {
          cwd: this.enginePath,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
          },
        });
      } catch (err) {
        clearTimeout(timer);
        this.state = 'error';
        this.emit('stateChange', this.state);
        reject(
          new Error(
            `Failed to spawn Python process: ${err instanceof Error ? err.message : String(err)}`
          )
        );
        return;
      }

      this.process.stdout?.on('data', (chunk: Buffer) => {
        this.handleStdout(chunk.toString('utf-8'));
      });

      this.process.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim();
        if (text) {
          console.error(`${LOG_PREFIX} stderr:`, text);
          this.emit('stderr', text);
        }
      });

      this.process.on('error', (err) => {
        console.error(`${LOG_PREFIX} process error:`, err.message);
        this.state = 'error';
        this.emit('stateChange', this.state);
        this.rejectAllPending(err);
      });

      this.process.on('exit', (code, signal) => {
        console.log(`${LOG_PREFIX} process exited (code=${code}, signal=${signal})`);
        this.state = 'stopped';
        this.emit('stateChange', this.state);
        this.rejectAllPending(new Error(`Engine process exited (code=${code}, signal=${signal})`));
        this.process = null;
      });

      // Wait for the engine's ready signal via a health_check response
      // or a simple "ready" line
      const onReady = (line: string) => {
        try {
          const msg = JSON.parse(line) as BridgeResponse;
          if (msg.action === 'health_check' || (msg.success && msg.data?.['ready'] === true)) {
            clearTimeout(timer);
            this.state = 'ready';
            this.emit('stateChange', this.state);
            this.removeListener('_rawLine', onReady);
            resolve();
          }
        } catch {
          // Not JSON — check for plain "ready" signal
          if (line.trim().toLowerCase() === 'ready') {
            clearTimeout(timer);
            this.state = 'ready';
            this.emit('stateChange', this.state);
            this.removeListener('_rawLine', onReady);
            resolve();
          }
        }
      };

      this.on('_rawLine', onReady);

      // Also send a health check to prompt the ready signal
      this.writeRaw(
        JSON.stringify({
          id: generateId(),
          action: 'health_check',
          payload: {},
        } satisfies BridgeCommand) + '\n'
      );
    });
  }

  /**
   * Send a command to the Python engine and wait for its response.
   */
  async send(
    action: BridgeAction,
    payload: Record<string, unknown>,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<BridgeResponse> {
    if (this.state !== 'ready' && this.state !== 'busy') {
      throw new Error(`Bridge is not ready (state=${this.state}). Call start() first.`);
    }

    const id = generateId();
    const command: BridgeCommand = { id, action, payload };

    return new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge command timed out after ${timeoutMs}ms: ${action}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      this.state = 'busy';
      this.emit('stateChange', this.state);

      this.writeRaw(JSON.stringify(command) + '\n');
    });
  }

  /**
   * Gracefully stop the Python engine subprocess.
   */
  async stop(): Promise<void> {
    if (!this.process) {
      this.state = 'stopped';
      return;
    }

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`${LOG_PREFIX} force-killing engine process`);
        this.process?.kill('SIGKILL');
        resolve();
      }, 5_000);

      this.process!.once('exit', () => {
        clearTimeout(timer);
        this.state = 'stopped';
        this.emit('stateChange', this.state);
        this.process = null;
        resolve();
      });

      // Try graceful shutdown first
      try {
        this.writeRaw(
          JSON.stringify({
            id: generateId(),
            action: 'health_check',
            payload: { shutdown: true },
          } satisfies BridgeCommand) + '\n'
        );
        this.process!.stdin?.end();
      } catch {
        this.process!.kill('SIGTERM');
      }
    });
  }

  // ── Private ──

  /** Write raw data to the subprocess stdin */
  private writeRaw(data: string): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('Engine stdin is not writable');
    }
    this.process.stdin.write(data);
  }

  /** Handle incoming stdout data (buffered, newline-delimited JSON) */
  private handleStdout(data: string): void {
    this.buffer += data;

    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) continue;

      // Emit raw line for startup detection
      this.emit('_rawLine', line);

      try {
        const msg = JSON.parse(line) as BridgeResponse | BridgeProgressEvent;

        // Progress events
        if ('percent' in msg && 'stage' in msg) {
          this.emit('progress', msg as BridgeProgressEvent);
          continue;
        }

        const resp = msg as BridgeResponse;
        const pending = this.pending.get(resp.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(resp.id);
          pending.resolve(resp);

          // Return to ready if no more pending
          if (this.pending.size === 0 && this.state === 'busy') {
            this.state = 'ready';
            this.emit('stateChange', this.state);
          }
        }
      } catch {
        // Non-JSON line from engine — log and continue
        console.log(`${LOG_PREFIX} engine:`, line);
      }
    }
  }

  /** Reject all pending requests (e.g. on process exit) */
  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }
}
