import crypto from 'crypto';
import Database from 'better-sqlite3';
import type { ViralTier } from '../social/scoring/viral-score';

// ============ Types ============

export interface DiscoveredContent {
  id: string;
  social_account_id: string | null;
  platform: string;
  source_url: string | null;
  source_author: string | null;
  content_type: string;
  title: string | null;
  body: string | null;
  media_urls: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  viral_score: number | null;
  viral_tier: string | null;
  external_id: string | null;
  query_hash: string | null;
  cache_expires_at: string | null;
  discovered_at: string;
  tags: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDiscoveredContentInput {
  social_account_id?: string | null;
  platform: string;
  source_url?: string | null;
  source_author?: string | null;
  content_type: string;
  title?: string | null;
  body?: string | null;
  media_urls?: string | null;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  external_id?: string | null;
  query_hash?: string | null;
  cache_expires_at?: string | null;
  tags?: string | null;
  metadata?: string | null;
}

export interface UpdateDiscoveredContentInput {
  social_account_id?: string | null;
  platform?: string;
  source_url?: string | null;
  source_author?: string | null;
  content_type?: string;
  title?: string | null;
  body?: string | null;
  media_urls?: string | null;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  tags?: string | null;
  metadata?: string | null;
}

// ============ Schema ============

export const DISCOVERED_CONTENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS discovered_content (
    id TEXT PRIMARY KEY,
    social_account_id TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
    platform TEXT NOT NULL,
    source_url TEXT,
    source_author TEXT,
    content_type TEXT NOT NULL,
    title TEXT,
    body TEXT,
    media_urls TEXT,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    discovered_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
    tags TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ'))
  );

  CREATE INDEX IF NOT EXISTS idx_discovered_content_platform
    ON discovered_content(platform);
  CREATE INDEX IF NOT EXISTS idx_discovered_content_type
    ON discovered_content(content_type);
  CREATE INDEX IF NOT EXISTS idx_discovered_content_discovered_at
    ON discovered_content(discovered_at);
  CREATE INDEX IF NOT EXISTS idx_discovered_content_account
    ON discovered_content(social_account_id);
`;

// ============ CRUD Class ============

export class DiscoveredContentStore {
  constructor(private db: Database.Database) {
    this.migrate();
  }

  private migrate(): void {
    const migrations = [
      'ALTER TABLE discovered_content ADD COLUMN viral_score REAL DEFAULT NULL',
      'ALTER TABLE discovered_content ADD COLUMN viral_tier TEXT DEFAULT NULL',
      'ALTER TABLE discovered_content ADD COLUMN external_id TEXT DEFAULT NULL',
      'ALTER TABLE discovered_content ADD COLUMN query_hash TEXT DEFAULT NULL',
      'ALTER TABLE discovered_content ADD COLUMN cache_expires_at TEXT DEFAULT NULL',
    ];
    for (const sql of migrations) {
      try {
        this.db.exec(sql);
      } catch {
        // Column already exists — ignore
      }
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_discovered_content_viral_score
        ON discovered_content(viral_score);
      CREATE INDEX IF NOT EXISTS idx_discovered_content_external_id
        ON discovered_content(platform, external_id);
      CREATE INDEX IF NOT EXISTS idx_discovered_content_query_hash
        ON discovered_content(query_hash, cache_expires_at);
    `);
  }

  create(input: CreateDiscoveredContentInput): DiscoveredContent {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO discovered_content
           (id, social_account_id, platform, source_url, source_author, content_type,
            title, body, media_urls, likes, comments, shares, views,
            external_id, query_hash, cache_expires_at, tags, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.social_account_id ?? null,
        input.platform,
        input.source_url ?? null,
        input.source_author ?? null,
        input.content_type,
        input.title ?? null,
        input.body ?? null,
        input.media_urls ?? null,
        input.likes ?? 0,
        input.comments ?? 0,
        input.shares ?? 0,
        input.views ?? 0,
        input.external_id ?? null,
        input.query_hash ?? null,
        input.cache_expires_at ?? null,
        input.tags ?? null,
        input.metadata ?? null
      );
    return this.getById(id)!;
  }

  getById(id: string): DiscoveredContent | null {
    const row = this.db.prepare('SELECT * FROM discovered_content WHERE id = ?').get(id) as
      | DiscoveredContent
      | undefined;
    return row ?? null;
  }

  getAll(): DiscoveredContent[] {
    return this.db
      .prepare('SELECT * FROM discovered_content ORDER BY discovered_at DESC')
      .all() as DiscoveredContent[];
  }

  update(id: string, input: UpdateDiscoveredContentInput): DiscoveredContent | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.social_account_id !== undefined) {
      fields.push('social_account_id = ?');
      values.push(input.social_account_id);
    }
    if (input.platform !== undefined) {
      fields.push('platform = ?');
      values.push(input.platform);
    }
    if (input.source_url !== undefined) {
      fields.push('source_url = ?');
      values.push(input.source_url);
    }
    if (input.source_author !== undefined) {
      fields.push('source_author = ?');
      values.push(input.source_author);
    }
    if (input.content_type !== undefined) {
      fields.push('content_type = ?');
      values.push(input.content_type);
    }
    if (input.title !== undefined) {
      fields.push('title = ?');
      values.push(input.title);
    }
    if (input.body !== undefined) {
      fields.push('body = ?');
      values.push(input.body);
    }
    if (input.media_urls !== undefined) {
      fields.push('media_urls = ?');
      values.push(input.media_urls);
    }
    if (input.likes !== undefined) {
      fields.push('likes = ?');
      values.push(input.likes);
    }
    if (input.comments !== undefined) {
      fields.push('comments = ?');
      values.push(input.comments);
    }
    if (input.shares !== undefined) {
      fields.push('shares = ?');
      values.push(input.shares);
    }
    if (input.views !== undefined) {
      fields.push('views = ?');
      values.push(input.views);
    }
    if (input.tags !== undefined) {
      fields.push('tags = ?');
      values.push(input.tags);
    }
    if (input.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(input.metadata);
    }

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
    values.push(id);

    this.db
      .prepare(`UPDATE discovered_content SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM discovered_content WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ============ Domain-specific queries ============

  getByPlatform(platform: string): DiscoveredContent[] {
    return this.db
      .prepare('SELECT * FROM discovered_content WHERE platform = ? ORDER BY discovered_at DESC')
      .all(platform) as DiscoveredContent[];
  }

  getByContentType(contentType: string): DiscoveredContent[] {
    return this.db
      .prepare(
        'SELECT * FROM discovered_content WHERE content_type = ? ORDER BY discovered_at DESC'
      )
      .all(contentType) as DiscoveredContent[];
  }

  getTopByEngagement(limit: number = 20): DiscoveredContent[] {
    return this.db
      .prepare(
        `SELECT * FROM discovered_content
         ORDER BY (likes + comments + shares + views) DESC
         LIMIT ?`
      )
      .all(limit) as DiscoveredContent[];
  }

  getByAccount(socialAccountId: string): DiscoveredContent[] {
    return this.db
      .prepare(
        'SELECT * FROM discovered_content WHERE social_account_id = ? ORDER BY discovered_at DESC'
      )
      .all(socialAccountId) as DiscoveredContent[];
  }

  getRecent(limit: number = 50): DiscoveredContent[] {
    return this.db
      .prepare('SELECT * FROM discovered_content ORDER BY discovered_at DESC LIMIT ?')
      .all(limit) as DiscoveredContent[];
  }

  getTopByViralScore(limit: number = 20): DiscoveredContent[] {
    return this.db
      .prepare(
        `SELECT * FROM discovered_content
         WHERE viral_score IS NOT NULL
         ORDER BY viral_score DESC
         LIMIT ?`
      )
      .all(limit) as DiscoveredContent[];
  }

  updateViralScore(id: string, score: number, tier: ViralTier): boolean {
    const result = this.db
      .prepare(
        `UPDATE discovered_content
         SET viral_score = ?, viral_tier = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))
         WHERE id = ?`
      )
      .run(score, tier, id);
    return result.changes > 0;
  }

  // ============ Cache queries ============

  findCached(queryHash: string, limit: number, offset: number = 0): DiscoveredContent[] {
    return this.db
      .prepare(
        `SELECT * FROM discovered_content
         WHERE query_hash = ? AND cache_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ')
         ORDER BY discovered_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(queryHash, limit, offset) as DiscoveredContent[];
  }

  findByExternalId(platform: string, externalId: string): DiscoveredContent | null {
    const row = this.db
      .prepare(
        'SELECT * FROM discovered_content WHERE platform = ? AND external_id = ?'
      )
      .get(platform, externalId) as DiscoveredContent | undefined;
    return row ?? null;
  }

  countCached(queryHash: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM discovered_content
         WHERE query_hash = ? AND cache_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ')`
      )
      .get(queryHash) as { cnt: number };
    return row.cnt;
  }
}
