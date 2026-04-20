import crypto from 'crypto';
import Database from 'better-sqlite3';

// ============ Types ============

export interface ArticlePendingDraft {
  id: string;
  source_id: string;
  article_url: string;
  title: string;
  excerpt: string | null;
  text_content: string;
  site_name: string | null;
  published_time: string | null;
  top_image: string | null;
  created_at: string;
}

export interface CreateArticlePendingDraftInput {
  source_id: string;
  article_url: string;
  title: string;
  excerpt?: string | null;
  text_content: string;
  site_name?: string | null;
  published_time?: string | null;
  top_image?: string | null;
}

// ============ Schema ============

export const ARTICLE_PENDING_DRAFTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS article_pending_drafts (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    article_url TEXT NOT NULL,
    title TEXT NOT NULL,
    excerpt TEXT,
    text_content TEXT NOT NULL,
    site_name TEXT,
    published_time TEXT,
    top_image TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
    FOREIGN KEY (source_id) REFERENCES article_sources(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_article_pending_source ON article_pending_drafts(source_id);
  CREATE INDEX IF NOT EXISTS idx_article_pending_created ON article_pending_drafts(created_at);
`;

// ============ Store ============

export class ArticlePendingDraftsStore {
  constructor(private db: Database.Database) {}

  create(input: CreateArticlePendingDraftInput): ArticlePendingDraft {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO article_pending_drafts
           (id, source_id, article_url, title, excerpt, text_content,
            site_name, published_time, top_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.source_id,
        input.article_url,
        input.title,
        input.excerpt ?? null,
        input.text_content,
        input.site_name ?? null,
        input.published_time ?? null,
        input.top_image ?? null
      );
    return this.getById(id)!;
  }

  getById(id: string): ArticlePendingDraft | null {
    return (
      (this.db
        .prepare('SELECT * FROM article_pending_drafts WHERE id = ?')
        .get(id) as ArticlePendingDraft | undefined) ?? null
    );
  }

  getBySource(sourceId: string): ArticlePendingDraft[] {
    return this.db
      .prepare(
        'SELECT * FROM article_pending_drafts WHERE source_id = ? ORDER BY created_at DESC, rowid DESC'
      )
      .all(sourceId) as ArticlePendingDraft[];
  }

  countBySource(sourceId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as c FROM article_pending_drafts WHERE source_id = ?')
      .get(sourceId) as { c: number };
    return row.c;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM article_pending_drafts WHERE id = ?').run(id).changes > 0;
  }

  /** Delete all pending drafts older than the given cutoff ISO timestamp. Returns purged count. */
  purgeOlderThan(cutoffIso: string): number {
    const result = this.db
      .prepare('DELETE FROM article_pending_drafts WHERE created_at < ?')
      .run(cutoffIso);
    return result.changes;
  }

  /** Unique article URLs already pending for a source (used alongside seen_urls for dedup). */
  getPendingUrls(sourceId: string): string[] {
    const rows = this.db
      .prepare('SELECT article_url FROM article_pending_drafts WHERE source_id = ?')
      .all(sourceId) as Array<{ article_url: string }>;
    return rows.map((r) => r.article_url);
  }
}
