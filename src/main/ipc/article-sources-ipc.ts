import { ipcMain, BrowserWindow } from 'electron';
import type { IPCDependencies } from './types';
import { detectSourceType, scrapeArticle } from '../../social/scraping/article';
import { runArticleScrapeJob } from '../../social/scraping/article-scrape-job';
import { logError } from '../../utils/file-logger';
import type {
  ArticleSource,
  ArticleSourceType,
  UpdateArticleSourceInput,
} from '../../memory/article-sources';

const PENDING_CLEANUP_JOB_NAME = '__article-pending-cleanup__';
const PENDING_CLEANUP_SCHEDULE = '0 3 * * *'; // daily 3am
const CRON_JOB_PREFIX = '__article-scrape__:';

const LOG_PREFIX = '[article-sources-ipc]';

const VALID_SCHEDULE_EXPRS = new Set([
  '0 * * * *', // hourly
  '0 */6 * * *', // every 6h
  '0 9 * * *', // daily 9am
  '0 9 * * 1', // weekly Mon 9am
]);

const DEFAULT_SCHEDULE = '0 */6 * * *';

function broadcast(action: 'created' | 'updated' | 'deleted', sourceId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('social:articleSourceChanged', { action, sourceId });
    }
  }
}

function deriveFallbackName(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, '');
    const root = host.split('.')[0];
    const section = pathname.split('/').filter(Boolean)[0];
    const left = root.charAt(0).toUpperCase() + root.slice(1);
    if (section && /^[a-z]+$/i.test(section)) {
      return `${left} ${section.charAt(0).toUpperCase() + section.slice(1)}`;
    }
    return left;
  } catch {
    return url;
  }
}

/**
 * Ensure the system-wide pending-cleanup cron exists. Idempotent (saveCronJob
 * upserts by name). Safe to call on every app boot.
 */
export async function ensurePendingCleanupCron(deps: IPCDependencies): Promise<void> {
  const scheduler = deps.getScheduler();
  if (!scheduler) return;
  await scheduler.createJob(
    PENDING_CLEANUP_JOB_NAME,
    PENDING_CLEANUP_SCHEDULE,
    'Article pending-drafts cleanup (7-day TTL)',
    'desktop',
    'default',
    'article-pending-cleanup'
  );
}

export function registerArticleSourcesIPC(deps: IPCDependencies): void {
  const { getMemory, getScheduler } = deps;

  ipcMain.handle('articleSources:list', async () => {
    const memory = getMemory();
    if (!memory) return { success: false as const, error: 'Memory not ready' };
    return { success: true as const, sources: memory.articleSources.getAll() };
  });

  ipcMain.handle('articleSources:add', async (_, url: string, scheduleExpr?: string) => {
    const memory = getMemory();
    if (!memory) return { success: false as const, error: 'Memory not ready' };

    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http(s) URLs supported');
    } catch (err) {
      return { success: false as const, error: `Invalid URL: ${(err as Error).message}` };
    }

    const schedule =
      scheduleExpr && VALID_SCHEDULE_EXPRS.has(scheduleExpr) ? scheduleExpr : DEFAULT_SCHEDULE;

    let sourceType: ArticleSourceType = 'article';
    let sourceName = deriveFallbackName(parsed.toString());

    try {
      const detected = await detectSourceType(parsed.toString());
      sourceType = detected.sourceType;
      if (sourceType === 'article') {
        try {
          const art = await scrapeArticle(parsed.toString());
          if (art.siteName) sourceName = art.siteName;
        } catch {
          /* keep fallback */
        }
      } else if (detected.doc) {
        const og = detected.doc
          .querySelector('meta[property="og:site_name"]')
          ?.getAttribute('content');
        if (og && og.trim()) sourceName = og.trim();
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} detection failed for ${url}: ${(err as Error).message}`);
      logError('article-sources-ipc', 'detection failed', err, { url });
    }

    const created = memory.articleSources.create({
      url: parsed.toString(),
      source_name: sourceName,
      source_type: sourceType,
      schedule_expr: schedule,
    });

    // Create the backing cron job (job_type='article-scrape', silent)
    const scheduler = getScheduler();
    if (scheduler) {
      const cronName = `${CRON_JOB_PREFIX}${created.id}`;
      const r = await scheduler.createJob(
        cronName,
        schedule,
        `Article source watcher for ${sourceName}`,
        'desktop',
        'default',
        'article-scrape'
      );
      if (r.success && r.id !== undefined) {
        memory.articleSources.update(created.id, { cron_job_id: r.id });
      }
    }

    const finalSource = memory.articleSources.getById(created.id) ?? created;
    broadcast('created', created.id);
    return { success: true as const, source: finalSource };
  });

  ipcMain.handle(
    'articleSources:update',
    async (_, id: string, input: UpdateArticleSourceInput) => {
      const memory = getMemory();
      if (!memory) return { success: false as const, error: 'Memory not ready' };

      const existing = memory.articleSources.getById(id);
      if (!existing) return { success: false as const, error: 'Source not found' };

      if (input.schedule_expr && !VALID_SCHEDULE_EXPRS.has(input.schedule_expr)) {
        return { success: false as const, error: 'Invalid schedule preset' };
      }

      const updated = memory.articleSources.update(id, input);
      if (!updated) return { success: false as const, error: 'Update failed' };

      // Propagate schedule / active changes to the backing cron job
      const scheduler = getScheduler();
      if (scheduler && updated.cron_job_id) {
        const cronName = `${CRON_JOB_PREFIX}${id}`;
        if (input.schedule_expr && input.schedule_expr !== existing.schedule_expr) {
          scheduler.deleteJob(cronName);
          const r = await scheduler.createJob(
            cronName,
            input.schedule_expr,
            `Article source watcher for ${updated.source_name}`,
            'desktop',
            'default',
            'article-scrape'
          );
          if (r.success && r.id !== undefined) {
            memory.articleSources.update(id, { cron_job_id: r.id });
          }
        }
        if (input.active !== undefined) {
          scheduler.setJobEnabled(cronName, input.active);
        }
      }

      broadcast('updated', id);
      return { success: true as const, source: memory.articleSources.getById(id) ?? updated };
    }
  );

  ipcMain.handle('articleSources:delete', async (_, id: string) => {
    const memory = getMemory();
    if (!memory) return { success: false as const, error: 'Memory not ready' };

    // Stop + delete the backing cron job first (cron_jobs has no FK cascade here).
    const scheduler = getScheduler();
    if (scheduler) {
      scheduler.deleteJob(`${CRON_JOB_PREFIX}${id}`);
    }

    const ok = memory.articleSources.delete(id);
    if (!ok) return { success: false as const, error: 'Source not found' };

    broadcast('deleted', id);
    return { success: true as const };
  });

  /**
   * Fire the scrape immediately (bypasses cron schedule). Uses the same
   * runArticleScrapeJob path the scheduler calls, so results land in
   * article_pending_drafts for Go/Skip approval.
   */
  ipcMain.handle('articleSources:runNow', async (_, id: string) => {
    const memory = getMemory();
    if (!memory) return { success: false as const, error: 'Memory not ready' };

    const source = memory.articleSources.getById(id);
    if (!source) return { success: false as const, error: 'Source not found' };

    const r = await runArticleScrapeJob(memory, id);
    broadcast('updated', id);

    if (r.error) {
      return { success: false as const, error: r.error };
    }
    return {
      success: true as const,
      sourceType: r.sourceType,
      itemsScraped: r.itemsScraped,
      itemsDeduped: r.itemsDeduped,
      itemsInserted: r.itemsInserted,
    };
  });

  // Pending-drafts queue management (used by UI Go/Skip modal)
  ipcMain.handle('articleSources:listPending', async (_, sourceId: string) => {
    const memory = getMemory();
    if (!memory) return { success: false as const, error: 'Memory not ready' };
    return {
      success: true as const,
      items: memory.articlePendingDrafts.getBySource(sourceId),
    };
  });

  ipcMain.handle('articleSources:countPending', async (_, sourceId: string) => {
    const memory = getMemory();
    if (!memory) return { success: false as const, error: 'Memory not ready' };
    return { success: true as const, count: memory.articlePendingDrafts.countBySource(sourceId) };
  });

  ipcMain.handle('articleSources:skipPending', async (_, pendingId: string) => {
    const memory = getMemory();
    if (!memory) return { success: false as const, error: 'Memory not ready' };
    const ok = memory.articlePendingDrafts.delete(pendingId);
    return ok
      ? ({ success: true as const } as const)
      : ({ success: false as const, error: 'Pending not found' } as const);
  });

  /**
   * Promote a pending draft into social_posts as a real draft on the chosen platform.
   * Removes from pending queue on success.
   */
  ipcMain.handle(
    'articleSources:goPending',
    async (_, pendingId: string, platform: string) => {
      const memory = getMemory();
      if (!memory) return { success: false as const, error: 'Memory not ready' };
      const pending = memory.articlePendingDrafts.getById(pendingId);
      if (!pending) return { success: false as const, error: 'Pending not found' };

      const post = memory.socialPosts.create({
        platform,
        status: 'draft',
        content: `${pending.title}\n\n${pending.text_content}`,
        metadata: JSON.stringify({
          article_url: pending.article_url,
          site_name: pending.site_name,
          published_time: pending.published_time,
          top_image: pending.top_image,
          source_id: pending.source_id,
        }),
      });
      memory.articlePendingDrafts.delete(pendingId);
      return { success: true as const, postId: post.id };
    }
  );

}

export type { ArticleSource };
