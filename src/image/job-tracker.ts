import { EventEmitter } from 'events';
import { Notification, app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { proxyFetch } from '../utils/proxy-fetch';
import { KieClient } from './kie-client';
import type { MemoryManager } from '../memory';

function debugLog(msg: string): void {
  try {
    const logPath = join(process.env.APPDATA || '', 'neon-post', 'kie-debug.log');
    appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* non-critical */ }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingJob {
  predictionId: string;
  prompt: string;
  model: string;
  aspectRatio?: string;
  quality?: string;
  platform?: string;
  sessionId?: string;
  createdAt: number;
}

export interface ImageReadyEvent {
  predictionId: string;
  imageUrl: string;
  savedId: string | null;
  prompt: string;
}

export interface ImageFailedEvent {
  predictionId: string;
  error: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// ImageJobTracker
// ---------------------------------------------------------------------------

export class ImageJobTracker extends EventEmitter {
  private jobs = new Map<string, PendingJob>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private client: KieClient | null = null;
  private memory: MemoryManager | null = null;

  private static POLL_INTERVAL = 30_000;
  private static MAX_AGE = 600_000; // 10 min

  /**
   * Initialise (or re-initialise) the tracker with an API key and memory
   * manager.  Can be called again if the API key changes.
   */
  init(apiKey: string, memoryManager: MemoryManager): void {
    this.client = new KieClient(apiKey);
    this.memory = memoryManager;
    console.log('[ImageJobTracker] Initialized with API key and memory manager');
  }

  /**
   * Register a new pending image-generation job for background polling.
   * Starts the poll timer if it is not already running.
   */
  track(job: Omit<PendingJob, 'createdAt'> & { sessionId?: string }): void {
    console.log(`[ImageJobTracker] Tracking job ${job.predictionId} (model=${job.model}, prompt="${job.prompt.slice(0, 60)}")`);
    this.jobs.set(job.predictionId, { ...job, createdAt: Date.now() });
    this.emit('image:generating', {
      predictionId: job.predictionId,
      prompt: job.prompt,
      model: job.model,
    });
    this.startTimer();
    console.log(`[ImageJobTracker] Active jobs: ${this.jobs.size}, polling every ${ImageJobTracker.POLL_INTERVAL / 1000}s`);
  }

  // ---- Timer management ---------------------------------------------------

  private startTimer(): void {
    if (this.timer) return;
    console.log('[ImageJobTracker] Starting poll timer');
    this.timer = setInterval(() => {
      void this.pollAll();
    }, ImageJobTracker.POLL_INTERVAL);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[ImageJobTracker] Poll timer stopped (no active jobs)');
    }
  }

  // ---- Polling ------------------------------------------------------------

  private async pollAll(): Promise<void> {
    if (!this.client) {
      console.warn('[ImageJobTracker] pollAll skipped — client not initialized (call init() first)');
      return;
    }

    const entries = [...this.jobs.entries()];
    console.log(`[ImageJobTracker] Polling ${entries.length} job(s)...`);

    for (const [id, job] of entries) {
      try {
        const result = await this.client.getStatus(id);
        console.log(`[ImageJobTracker] Job ${id}: status=${result.status}${result.imageUrl ? ', has imageUrl' : ''}`);

        debugLog(`Job ${id}: status=${result.status}, imageUrl=${result.imageUrl?.slice(0, 80)}`);

        if (result.status === 'completed') {
          const imageUrl = result.imageUrl ?? '';
          if (!imageUrl) {
            debugLog(`Job ${id} completed but NO imageUrl!`);
          }
          const savedId = this.saveToGallery(job, imageUrl);
          if (savedId && imageUrl) {
            void this.downloadToLocal(savedId, imageUrl);
          }
          debugLog(`Job ${id} completed — savedId=${savedId}, imageUrl=${imageUrl.slice(0, 80)}`);
          const event: ImageReadyEvent = {
            predictionId: id,
            imageUrl,
            savedId,
            prompt: job.prompt,
          };
          this.emit('image:ready', event);
          console.log(`[ImageJobTracker] Emitted 'image:ready' for ${id}`);
          this.persistImageMessage(job, imageUrl, savedId);
          this.notify('Image ready ✨', job.prompt.slice(0, 80));
          this.jobs.delete(id);
          continue;
        }

        if (result.status === 'failed') {
          console.error(`[ImageJobTracker] Job ${id} FAILED: ${result.error}`);
          const event: ImageFailedEvent = {
            predictionId: id,
            error: result.error ?? 'Unknown error',
            prompt: job.prompt,
          };
          this.emit('image:failed', event);
          this.persistFailedMessage(job, result.error ?? 'Unknown error');
          this.notify('Image failed', result.error ?? 'Unknown error');
          this.jobs.delete(id);
          continue;
        }

        // Still processing — check for timeout
        const elapsed = Date.now() - job.createdAt;
        console.log(`[ImageJobTracker] Job ${id} still processing (${Math.round(elapsed / 1000)}s elapsed)`);
        if (job.createdAt + ImageJobTracker.MAX_AGE < Date.now()) {
          console.error(`[ImageJobTracker] Job ${id} TIMED OUT after ${ImageJobTracker.MAX_AGE / 1000}s`);
          const event: ImageFailedEvent = {
            predictionId: id,
            error: 'Job timed out after 10 minutes',
            prompt: job.prompt,
          };
          this.emit('image:failed', event);
          this.persistFailedMessage(job, 'Job timed out after 10 minutes');
          this.notify('Image timed out', job.prompt.slice(0, 80));
          this.jobs.delete(id);
        }
      } catch (err) {
        console.error(`[ImageJobTracker] Poll error for job ${id}:`, err);
        // Network / API errors are non-fatal — we'll retry next cycle.
        // If the job has exceeded its max age though, give up.
        if (job.createdAt + ImageJobTracker.MAX_AGE < Date.now()) {
          const event: ImageFailedEvent = {
            predictionId: id,
            error: `Job timed out: ${err instanceof Error ? err.message : String(err)}`,
            prompt: job.prompt,
          };
          this.emit('image:failed', event);
          this.jobs.delete(id);
        }
      }
    }

    if (this.jobs.size === 0) {
      this.stopTimer();
    }
  }

  // ---- Persistence --------------------------------------------------------

  private saveToGallery(job: PendingJob, imageUrl: string): string | null {
    if (!this.memory) {
      debugLog('saveToGallery SKIPPED — no memory manager');
      console.warn('[ImageJobTracker] saveToGallery skipped — memory manager not set');
      return null;
    }
    debugLog(`saveToGallery called — memory exists, has generatedContent: ${!!this.memory.generatedContent}`);
    try {
      const record = this.memory.generatedContent.create({
        content_type: 'image',
        platform: job.platform ?? null,
        prompt_used: job.prompt,
        output: job.prompt,
        media_url: imageUrl,
        metadata: JSON.stringify({
          model: job.model,
          aspect_ratio: job.aspectRatio,
          quality: job.quality,
          prediction_id: job.predictionId,
        }),
      });
      debugLog(`saveToGallery SUCCESS — id=${record.id}`);
      console.log(`[ImageJobTracker] Saved to gallery: id=${record.id}, media_url=${imageUrl.slice(0, 80)}`);
      return record.id;
    } catch (err) {
      debugLog(`saveToGallery FAILED: ${err instanceof Error ? err.message : String(err)}`);
      console.error('[ImageJobTracker] saveToGallery FAILED:', err);
      return null;
    }
  }

  // ---- Local download ------------------------------------------------------

  private async downloadToLocal(recordId: string, remoteUrl: string): Promise<void> {
    try {
      const mediaDir = join(app.getPath('documents'), 'Neon-post', 'media');
      if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });

      const res = await proxyFetch(remoteUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      const contentType = res.headers.get('content-type') || '';
      const ext = contentType.includes('jpeg') || contentType.includes('jpg')
        ? '.jpg'
        : contentType.includes('gif')
          ? '.gif'
          : contentType.includes('webp')
            ? '.webp'
            : '.png';

      const filename = `img-${Date.now()}${ext}`;
      const filePath = join(mediaDir, filename);
      writeFileSync(filePath, buf);

      this.memory?.generatedContent.update(recordId, { media_url: filePath });
      console.log(`[ImageJobTracker] Downloaded to local: ${filePath}`);
    } catch (err) {
      console.error('[ImageJobTracker] Failed to download image locally:', err);
    }
  }

  // ---- Chat message persistence -------------------------------------------

  private persistImageMessage(job: PendingJob, imageUrl: string, savedId: string | null): void {
    if (!this.memory) return;
    try {
      const sessionId = job.sessionId || 'default';
      this.memory.saveMessage('assistant', `[Generated image: ${job.prompt}]`, sessionId, {
        type: 'generated-image',
        imageUrl,
        savedId,
        prompt: job.prompt,
        model: job.model,
        predictionId: job.predictionId,
      });
    } catch (err) {
      console.error('[ImageJobTracker] Failed to persist image message:', err);
    }
  }

  private persistFailedMessage(job: PendingJob, error: string): void {
    if (!this.memory) return;
    try {
      const sessionId = job.sessionId || 'default';
      this.memory.saveMessage('assistant', `[Image generation failed: ${error}]`, sessionId, {
        type: 'generated-image-error',
        error,
        prompt: job.prompt,
        model: job.model,
        predictionId: job.predictionId,
      });
    } catch (err) {
      console.error('[ImageJobTracker] Failed to persist error message:', err);
    }
  }

  // ---- Desktop notifications ----------------------------------------------

  private notify(title: string, body: string): void {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    } catch {
      // Notification failures are non-critical
    }
  }

  // ---- Cleanup ------------------------------------------------------------

  /**
   * Stop polling and discard all tracked jobs.
   */
  destroy(): void {
    this.stopTimer();
    this.jobs.clear();
  }
}
