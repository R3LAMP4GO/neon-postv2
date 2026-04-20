import { ipcMain, BrowserWindow } from 'electron';
import type { IPCDependencies } from './types';
import {
  scrapeSource,
  detectSourceType,
  scrapeArticle,
  ArticleScrapeError,
} from '../../social/scraping/article';
import type {
  ArticleSource,
  ArticleSourceType,
  UpdateArticleSourceInput,
} from '../../memory/article-sources';

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

export function registerArticleSourcesIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

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
    }

    const created = memory.articleSources.create({
      url: parsed.toString(),
      source_name: sourceName,
      source_type: sourceType,
      schedule_expr: schedule,
    });

    broadcast('created', created.id);
    return { success: true as const, source: created };
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

      broadcast('updated', id);
      return { success: true as const, source: updated };
    }
  );

  ipcMain.handle('articleSources:delete', async (_, id: string) => {
    const memory = getMemory();
    if (!memory) return { success: false as const, error: 'Memory not ready' };

    const ok = memory.articleSources.delete(id);
    if (!ok) return { success: false as const, error: 'Source not found' };

    broadcast('deleted', id);
    return { success: true as const };
  });

  /**
   * Scrape the source on demand and return preview items.
   * Phase 3 will wire this into draft insertion; for now it's a read-only preview.
   */
  ipcMain.handle('articleSources:runNow', async (_, id: string) => {
    const memory = getMemory();
    if (!memory) return { success: false as const, error: 'Memory not ready' };

    const source = memory.articleSources.getById(id);
    if (!source) return { success: false as const, error: 'Source not found' };

    try {
      const result = await scrapeSource(source.url);
      memory.articleSources.touchLastRun(id, 'ok', null);
      broadcast('updated', id);
      return {
        success: true as const,
        sourceType: result.sourceType,
        items: result.items.map((a) => ({
          url: a.url,
          title: a.title,
          excerpt: a.excerpt,
          siteName: a.siteName,
          publishedTime: a.publishedTime,
          topImage: a.topImage,
        })),
      };
    } catch (err) {
      const message = err instanceof ArticleScrapeError ? err.message : (err as Error).message;
      memory.articleSources.touchLastRun(id, 'error', message.slice(0, 200));
      broadcast('updated', id);
      console.error(`${LOG_PREFIX} runNow failed for ${source.url}: ${message}`);
      return { success: false as const, error: message };
    }
  });
}

export type { ArticleSource };
