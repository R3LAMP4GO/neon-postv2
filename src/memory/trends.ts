import crypto from 'crypto';
import Database from 'better-sqlite3';

// ============ Types ============

export type TrendStatusValue = 'breakout' | 'rising' | 'emerging' | 'stale';

export interface EmergingTrend {
  id: string;
  keyword: string;
  platform: string | null;
  score: number;
  status: TrendStatusValue;
  sample_content_ids: string; // JSON array
  first_seen: string;
  last_updated: string;
  dismissed: number; // 0 or 1
}

export interface CreateTrendInput {
  keyword: string;
  platform?: string | null;
  score: number;
  status: TrendStatusValue;
  sample_content_ids?: string[];
}

export interface UpdateTrendInput {
  score?: number;
  status?: TrendStatusValue;
  sample_content_ids?: string[];
  dismissed?: boolean;
}

// ============ Schema ============

export const EMERGING_TRENDS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS emerging_trends (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL,
    platform TEXT,
    score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'emerging' CHECK(status IN ('breakout', 'rising', 'emerging', 'stale')),
    sample_content_ids TEXT NOT NULL DEFAULT '[]',
    first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
    last_updated TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
    dismissed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_emerging_trends_status ON emerging_trends(status);
  CREATE INDEX IF NOT EXISTS idx_emerging_trends_keyword ON emerging_trends(keyword);
  CREATE INDEX IF NOT EXISTS idx_emerging_trends_score ON emerging_trends(score DESC);
`;

// ============ Store ============

export class TrendsStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Create a new trend. */
  create(input: CreateTrendInput): EmergingTrend {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const sampleIds = JSON.stringify(input.sample_content_ids ?? []);

    this.db
      .prepare(
        `INSERT INTO emerging_trends (id, keyword, platform, score, status, sample_content_ids, first_seen, last_updated, dismissed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(id, input.keyword, input.platform ?? null, input.score, input.status, sampleIds, now, now);

    return this.getById(id)!;
  }

  /** Get a trend by ID. */
  getById(id: string): EmergingTrend | null {
    return (
      (this.db.prepare('SELECT * FROM emerging_trends WHERE id = ?').get(id) as
        | EmergingTrend
        | undefined) ?? null
    );
  }

  /** Update an existing trend. */
  update(id: string, updates: UpdateTrendInput): EmergingTrend | null {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.score !== undefined) {
      sets.push('score = ?');
      values.push(updates.score);
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.sample_content_ids !== undefined) {
      sets.push('sample_content_ids = ?');
      values.push(JSON.stringify(updates.sample_content_ids));
    }
    if (updates.dismissed !== undefined) {
      sets.push('dismissed = ?');
      values.push(updates.dismissed ? 1 : 0);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push('last_updated = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db
      .prepare(`UPDATE emerging_trends SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id);
  }

  /** Upsert a trend by keyword (and optional platform). Updates score/status if exists, creates if not. */
  upsert(input: CreateTrendInput): EmergingTrend {
    const existing = this.db
      .prepare(
        input.platform
          ? 'SELECT * FROM emerging_trends WHERE keyword = ? AND platform = ?'
          : 'SELECT * FROM emerging_trends WHERE keyword = ? AND platform IS NULL'
      )
      .get(...(input.platform ? [input.keyword, input.platform] : [input.keyword])) as
      | EmergingTrend
      | undefined;

    if (existing) {
      return this.update(existing.id, {
        score: input.score,
        status: input.status,
        sample_content_ids: input.sample_content_ids,
      })!;
    }

    return this.create(input);
  }

  /** Get all active (non-dismissed) trends, ordered by score descending. */
  getActive(limit = 50): EmergingTrend[] {
    return this.db
      .prepare(
        'SELECT * FROM emerging_trends WHERE dismissed = 0 AND status != ? ORDER BY score DESC LIMIT ?'
      )
      .all('stale', limit) as EmergingTrend[];
  }

  /** Get trends by status. */
  getByStatus(status: TrendStatusValue, limit = 50): EmergingTrend[] {
    return this.db
      .prepare('SELECT * FROM emerging_trends WHERE status = ? AND dismissed = 0 ORDER BY score DESC LIMIT ?')
      .all(status, limit) as EmergingTrend[];
  }

  /** Dismiss a trend (hide it from active views). */
  dismiss(id: string): boolean {
    const result = this.db
      .prepare('UPDATE emerging_trends SET dismissed = 1, last_updated = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  /** Delete a trend. */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM emerging_trends WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** Get all trends (including dismissed). */
  getAll(limit = 100): EmergingTrend[] {
    return this.db
      .prepare('SELECT * FROM emerging_trends ORDER BY score DESC LIMIT ?')
      .all(limit) as EmergingTrend[];
  }
}
