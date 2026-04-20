/**
 * Unit tests for runArticleScrapeJob + runPendingCleanupJob.
 *
 * Uses an in-memory DB with the article_sources + article_pending_drafts schema,
 * mocks scrapeSource from src/social/scraping/article, and asserts:
 *   - Fresh articles insert into pending drafts
 *   - Already-seen URLs dedup via seen_urls
 *   - Already-pending URLs dedup via current pending rows
 *   - Failure path sets last_status='error' and last_error
 *   - runPendingCleanupJob purges rows older than the TTL
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock scrapeSource before importing the job module
const mockScrapeSource = vi.fn();
vi.mock('../../src/social/scraping/article', () => ({
  scrapeSource: (...args: unknown[]) => mockScrapeSource(...args),
  ArticleScrapeError: class ArticleScrapeError extends Error {},
}));

import {
  ArticleSourcesStore,
  ARTICLE_SOURCES_SCHEMA,
} from '../../src/memory/article-sources';
import {
  ArticlePendingDraftsStore,
  ARTICLE_PENDING_DRAFTS_SCHEMA,
} from '../../src/memory/article-pending-drafts';
import {
  runArticleScrapeJob,
  runPendingCleanupJob,
  PENDING_TTL_MS,
} from '../../src/social/scraping/article-scrape-job';

// Minimal MemoryManager-shaped stub, just what the job cares about
function makeMemoryStub() {
  const db = new Database(':memory:');
  db.exec(ARTICLE_SOURCES_SCHEMA);
  db.exec(ARTICLE_PENDING_DRAFTS_SCHEMA);
  return {
    db,
    articleSources: new ArticleSourcesStore(db),
    articlePendingDrafts: new ArticlePendingDraftsStore(db),
  };
}

type MemoryStub = ReturnType<typeof makeMemoryStub>;

function makeArticleResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    url: 'https://example.com/a1',
    title: 'Article One',
    byline: null,
    excerpt: 'An excerpt',
    textContent: 'Some body text long enough to be meaningful',
    content: '<p>html</p>',
    siteName: 'Example',
    publishedTime: '2026-04-20T12:00:00Z',
    topImage: 'https://example.com/img.jpg',
    lang: 'en',
    ...overrides,
  };
}

describe('runArticleScrapeJob', () => {
  let memory: MemoryStub;

  beforeEach(() => {
    mockScrapeSource.mockReset();
    memory = makeMemoryStub();
  });

  it('inserts pending drafts for fresh articles and records seen_urls', async () => {
    const src = memory.articleSources.create({
      url: 'https://example.com/feed',
      source_name: 'Example',
      source_type: 'feed',
      schedule_expr: '0 */6 * * *',
    });

    mockScrapeSource.mockResolvedValueOnce({
      sourceType: 'feed',
      items: [makeArticleResult({ url: 'https://example.com/a1' }), makeArticleResult({ url: 'https://example.com/a2', title: 'Two' })],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runArticleScrapeJob(memory as any, src.id);

    expect(r.itemsScraped).toBe(2);
    expect(r.itemsInserted).toBe(2);
    expect(r.itemsDeduped).toBe(0);

    const pending = memory.articlePendingDrafts.getBySource(src.id);
    expect(pending).toHaveLength(2);

    const fresh = memory.articleSources.getById(src.id);
    expect(fresh?.seen_urls).toEqual(['https://example.com/a1', 'https://example.com/a2']);
    expect(fresh?.last_status).toBe('ok');
  });

  it('dedups via seen_urls ring buffer (second fire skips seen items)', async () => {
    const src = memory.articleSources.create({
      url: 'https://example.com/feed',
      source_name: 'Example',
      source_type: 'feed',
      schedule_expr: '0 */6 * * *',
    });

    mockScrapeSource.mockResolvedValueOnce({
      sourceType: 'feed',
      items: [makeArticleResult({ url: 'https://example.com/a1' })],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runArticleScrapeJob(memory as any, src.id);

    // Second fire returns the same URL plus a new one
    mockScrapeSource.mockResolvedValueOnce({
      sourceType: 'feed',
      items: [
        makeArticleResult({ url: 'https://example.com/a1' }),
        makeArticleResult({ url: 'https://example.com/a2', title: 'Two' }),
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r2 = await runArticleScrapeJob(memory as any, src.id);

    expect(r2.itemsDeduped).toBe(1);
    expect(r2.itemsInserted).toBe(1);

    const pending = memory.articlePendingDrafts.getBySource(src.id);
    expect(pending).toHaveLength(2);
  });

  it('dedups via currently-pending URLs (not yet promoted to drafts)', async () => {
    const src = memory.articleSources.create({
      url: 'https://example.com/feed',
      source_name: 'Example',
      source_type: 'feed',
      schedule_expr: '0 */6 * * *',
    });

    // Pre-seed a pending row (simulating a previous scrape where seen_urls was cleared)
    memory.articlePendingDrafts.create({
      source_id: src.id,
      article_url: 'https://example.com/a1',
      title: 'Preexisting',
      text_content: 'body',
    });

    mockScrapeSource.mockResolvedValueOnce({
      sourceType: 'feed',
      items: [makeArticleResult({ url: 'https://example.com/a1' })],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runArticleScrapeJob(memory as any, src.id);
    expect(r.itemsDeduped).toBe(1);
    expect(r.itemsInserted).toBe(0);
    expect(memory.articlePendingDrafts.countBySource(src.id)).toBe(1);
  });

  it('sets last_status=error and last_error when scrape throws', async () => {
    const src = memory.articleSources.create({
      url: 'https://paywall.example',
      source_name: 'Paywall',
      source_type: 'article',
      schedule_expr: '0 */6 * * *',
    });

    mockScrapeSource.mockRejectedValueOnce(new Error('HTTP 403 for https://paywall.example'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runArticleScrapeJob(memory as any, src.id);
    expect(r.error).toContain('403');
    expect(r.itemsInserted).toBe(0);

    const after = memory.articleSources.getById(src.id);
    expect(after?.last_status).toBe('error');
    expect(after?.last_error).toContain('403');
  });

  it('returns error result when source does not exist', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runArticleScrapeJob(memory as any, 'nonexistent-id');
    expect(r.error).toContain('not found');
    expect(mockScrapeSource).not.toHaveBeenCalled();
  });
});

describe('runPendingCleanupJob', () => {
  let memory: MemoryStub;

  beforeEach(() => {
    memory = makeMemoryStub();
  });

  it('purges rows older than TTL and leaves fresh rows alone', () => {
    const src = memory.articleSources.create({
      url: 'https://example.com',
      source_name: 'Ex',
      source_type: 'article',
      schedule_expr: '0 */6 * * *',
    });

    // Insert a fresh row
    const fresh = memory.articlePendingDrafts.create({
      source_id: src.id,
      article_url: 'https://example.com/fresh',
      title: 'Fresh',
      text_content: 'x',
    });

    // Insert a row and manually backdate its created_at to > 7 days ago
    const oldRow = memory.articlePendingDrafts.create({
      source_id: src.id,
      article_url: 'https://example.com/old',
      title: 'Old',
      text_content: 'x',
    });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    memory.db
      .prepare('UPDATE article_pending_drafts SET created_at = ? WHERE id = ?')
      .run(eightDaysAgo, oldRow.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = runPendingCleanupJob(memory as any);
    expect(r.purged).toBe(1);
    expect(memory.articlePendingDrafts.getById(fresh.id)).not.toBeNull();
    expect(memory.articlePendingDrafts.getById(oldRow.id)).toBeNull();
  });

  it('cutoff matches PENDING_TTL_MS (7 days)', () => {
    expect(PENDING_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
