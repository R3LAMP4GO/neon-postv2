/**
 * Unit tests for ArticleSourcesStore (src/memory/article-sources.ts).
 *
 * Uses an in-memory better-sqlite3 DB with just the article_sources schema applied.
 * Covers CRUD, seen_urls ring buffer dedup, and touchLastRun convenience.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

import { ArticleSourcesStore, ARTICLE_SOURCES_SCHEMA } from '../../src/memory/article-sources';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(ARTICLE_SOURCES_SCHEMA);
  return db;
}

describe('ArticleSourcesStore', () => {
  let db: Database.Database;
  let store: ArticleSourcesStore;

  beforeEach(() => {
    db = makeDb();
    store = new ArticleSourcesStore(db);
  });

  it('creates a source with defaults (active=true, empty seen_urls)', () => {
    const src = store.create({
      url: 'https://www.cnn.com/sport',
      source_name: 'CNN Sports',
      source_type: 'index',
      schedule_expr: '0 */6 * * *',
    });
    expect(src.id).toBeTruthy();
    expect(src.url).toBe('https://www.cnn.com/sport');
    expect(src.source_name).toBe('CNN Sports');
    expect(src.source_type).toBe('index');
    expect(src.schedule_expr).toBe('0 */6 * * *');
    expect(src.active).toBe(true);
    expect(src.seen_urls).toEqual([]);
    expect(src.cron_job_id).toBeNull();
    expect(src.last_status).toBeNull();
  });

  it('getAll returns sources newest-first', () => {
    store.create({
      url: 'https://a.com',
      source_name: 'A',
      source_type: 'article',
      schedule_expr: '0 * * * *',
    });
    store.create({
      url: 'https://b.com',
      source_name: 'B',
      source_type: 'article',
      schedule_expr: '0 * * * *',
    });
    const all = store.getAll();
    expect(all.map((s) => s.source_name)).toEqual(['B', 'A']);
  });

  it('update flips active and persists', () => {
    const src = store.create({
      url: 'https://x.com',
      source_name: 'X',
      source_type: 'article',
      schedule_expr: '0 * * * *',
    });
    const updated = store.update(src.id, { active: false });
    expect(updated?.active).toBe(false);
    expect(store.getActive()).toHaveLength(0);
  });

  it('update returns existing row when no fields supplied', () => {
    const src = store.create({
      url: 'https://x.com',
      source_name: 'X',
      source_type: 'article',
      schedule_expr: '0 * * * *',
    });
    const unchanged = store.update(src.id, {});
    expect(unchanged?.id).toBe(src.id);
  });

  it('delete removes the row', () => {
    const src = store.create({
      url: 'https://x.com',
      source_name: 'X',
      source_type: 'article',
      schedule_expr: '0 * * * *',
    });
    expect(store.delete(src.id)).toBe(true);
    expect(store.getById(src.id)).toBeNull();
  });

  it('recordSeenUrls dedups within current set', () => {
    const src = store.create({
      url: 'https://feed.example',
      source_name: 'Feed',
      source_type: 'feed',
      schedule_expr: '0 */6 * * *',
    });
    store.recordSeenUrls(src.id, ['https://a.com/1', 'https://a.com/2']);
    store.recordSeenUrls(src.id, ['https://a.com/2', 'https://a.com/3']);
    const fetched = store.getById(src.id);
    expect(fetched?.seen_urls).toEqual(['https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
  });

  it('recordSeenUrls caps at N=20 keeping most recent', () => {
    const src = store.create({
      url: 'https://feed.example',
      source_name: 'Feed',
      source_type: 'feed',
      schedule_expr: '0 */6 * * *',
    });
    const urls = Array.from({ length: 25 }, (_, i) => `https://a.com/${i}`);
    store.recordSeenUrls(src.id, urls);
    const fetched = store.getById(src.id);
    expect(fetched?.seen_urls).toHaveLength(20);
    // Last 20 are kept (indexes 5..24)
    expect(fetched?.seen_urls[0]).toBe('https://a.com/5');
    expect(fetched?.seen_urls[19]).toBe('https://a.com/24');
  });

  it('touchLastRun updates status, timestamp, and error', () => {
    const src = store.create({
      url: 'https://x.com',
      source_name: 'X',
      source_type: 'article',
      schedule_expr: '0 * * * *',
    });
    const before = new Date().toISOString();
    const after = store.touchLastRun(src.id, 'error', 'paywall 403');
    expect(after?.last_status).toBe('error');
    expect(after?.last_error).toBe('paywall 403');
    expect((after?.last_run_at || '') >= before).toBe(true);
  });

  it('touchLastRun clears last_error on ok status', () => {
    const src = store.create({
      url: 'https://x.com',
      source_name: 'X',
      source_type: 'article',
      schedule_expr: '0 * * * *',
    });
    store.touchLastRun(src.id, 'error', 'bad');
    const ok = store.touchLastRun(src.id, 'ok', null);
    expect(ok?.last_status).toBe('ok');
    expect(ok?.last_error).toBeNull();
  });

  it('getByCronJobId looks up by backing cron job', () => {
    const src = store.create({
      url: 'https://x.com',
      source_name: 'X',
      source_type: 'article',
      schedule_expr: '0 * * * *',
      cron_job_id: 42,
    });
    const found = store.getByCronJobId(42);
    expect(found?.id).toBe(src.id);
    expect(store.getByCronJobId(999)).toBeNull();
  });
});
