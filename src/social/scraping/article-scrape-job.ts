/**
 * Article-scrape job execution.
 *
 * Invoked by CronScheduler when a `job_type='article-scrape'` or
 * `job_type='article-pending-cleanup'` cron job fires. Kept separate from
 * the extractor (article.ts) so the scheduler depends only on a small,
 * testable surface area.
 */

import type { MemoryManager } from '../../memory';
import { scrapeSource, ArticleScrapeError } from './article';
import { logError, logInfo } from '../../utils/file-logger';

const LOG_PREFIX = '[article-scrape-job]';

/** Retention window for items awaiting Go approval (7 days). */
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ArticleScrapeJobResult {
  sourceId: string;
  sourceType: 'article' | 'feed' | 'index' | 'unknown';
  itemsScraped: number;
  itemsDeduped: number;
  itemsInserted: number;
  error?: string;
}

export interface PendingCleanupResult {
  purged: number;
  cutoffIso: string;
}

/**
 * Run one fire of an article-scrape job: scrape the source, dedup against
 * seen_urls + currently-pending URLs, insert new candidates into
 * article_pending_drafts, update seen_urls + last_status on the source.
 */
export async function runArticleScrapeJob(
  memory: MemoryManager,
  sourceId: string
): Promise<ArticleScrapeJobResult> {
  const source = memory.articleSources.getById(sourceId);
  if (!source) {
    const error = `Article source ${sourceId} not found`;
    console.warn(`${LOG_PREFIX} ${error}`);
    return {
      sourceId,
      sourceType: 'unknown',
      itemsScraped: 0,
      itemsDeduped: 0,
      itemsInserted: 0,
      error,
    };
  }

  try {
    const result = await scrapeSource(source.url);
    const alreadySeen = new Set<string>([
      ...source.seen_urls,
      ...memory.articlePendingDrafts.getPendingUrls(sourceId),
    ]);

    const fresh = result.items.filter((item) => !alreadySeen.has(item.url));
    const deduped = result.items.length - fresh.length;

    for (const art of fresh) {
      memory.articlePendingDrafts.create({
        source_id: sourceId,
        article_url: art.url,
        title: art.title,
        excerpt: art.excerpt,
        text_content: art.textContent,
        site_name: art.siteName,
        published_time: art.publishedTime,
        top_image: art.topImage,
      });
    }

    if (fresh.length > 0) {
      memory.articleSources.recordSeenUrls(
        sourceId,
        fresh.map((a) => a.url)
      );
    }

    memory.articleSources.touchLastRun(sourceId, 'ok', null);

    console.log(
      `${LOG_PREFIX} ${source.source_name}: scraped=${result.items.length} deduped=${deduped} inserted=${fresh.length}`
    );
    logInfo('article-scrape-job', 'run ok', {
      sourceId,
      sourceName: source.source_name,
      url: source.url,
      sourceType: result.sourceType,
      itemsScraped: result.items.length,
      itemsDeduped: deduped,
      itemsInserted: fresh.length,
    });

    return {
      sourceId,
      sourceType: result.sourceType,
      itemsScraped: result.items.length,
      itemsDeduped: deduped,
      itemsInserted: fresh.length,
    };
  } catch (err) {
    const message = err instanceof ArticleScrapeError ? err.message : (err as Error).message;
    memory.articleSources.touchLastRun(sourceId, 'error', message.slice(0, 200));
    console.error(`${LOG_PREFIX} scrape failed for ${source.url}: ${message}`);
    logError('article-scrape-job', 'run failed', err, {
      sourceId,
      sourceName: source.source_name,
      url: source.url,
    });
    return {
      sourceId,
      sourceType: 'unknown',
      itemsScraped: 0,
      itemsDeduped: 0,
      itemsInserted: 0,
      error: message,
    };
  }
}

/** Purge pending drafts older than PENDING_TTL_MS from the DB. */
export function runPendingCleanupJob(
  memory: MemoryManager,
  now: Date = new Date()
): PendingCleanupResult {
  const cutoff = new Date(now.getTime() - PENDING_TTL_MS);
  const cutoffIso = cutoff.toISOString();
  const purged = memory.articlePendingDrafts.purgeOlderThan(cutoffIso);
  if (purged > 0) {
    console.log(`${LOG_PREFIX} purged ${purged} pending drafts older than ${cutoffIso}`);
  }
  return { purged, cutoffIso };
}
