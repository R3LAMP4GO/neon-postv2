import crypto from 'crypto';
import Database from 'better-sqlite3';

// ============ Types ============

export type ArticleSourceType = 'article' | 'feed' | 'index';
export type ArticleSourceStatus = 'ok' | 'error' | null;

export interface ArticleSource {
  id: string;
  url: string;
  source_name: string;
  source_type: ArticleSourceType;
  schedule_expr: string;
  cron_job_id: number | null;
  seen_urls: string[];
  last_run_at: string | null;
  last_status: ArticleSourceStatus;
  last_error: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateArticleSourceInput {
  url: string;
  source_name: string;
  source_type: ArticleSourceType;
  schedule_expr: string;
  cron_job_id?: number | null;
}

export interface UpdateArticleSourceInput {
  source_name?: string;
  schedule_expr?: string;
  cron_job_id?: number | null;
  active?: boolean;
  last_run_at?: string | null;
  last_status?: ArticleSourceStatus;
  last_error?: string | null;
  seen_urls?: string[];
}

// ============ Schema ============

export const ARTICLE_SOURCES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS article_sources (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('article', 'feed', 'index')),
    schedule_expr TEXT NOT NULL,
    cron_job_id INTEGER,
    seen_urls TEXT NOT NULL DEFAULT '[]',
    last_run_at TEXT,
    last_status TEXT CHECK(last_status IN ('ok', 'error')),
    last_error TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ'))
  );

  CREATE INDEX IF NOT EXISTS idx_article_sources_active ON article_sources(active);
  CREATE INDEX IF NOT EXISTS idx_article_sources_cron ON article_sources(cron_job_id);
`;

const SEEN_URL_LIMIT = 20;

// ============ CRUD Class ============

type ArticleSourceRow = Omit<ArticleSource, 'active' | 'seen_urls'> & {
  active: number;
  seen_urls: string;
};

function rowToSource(row: ArticleSourceRow): ArticleSource {
  let parsed: string[] = [];
  try {
    const v = JSON.parse(row.seen_urls);
    if (Array.isArray(v)) parsed = v.filter((x) => typeof x === 'string');
  } catch {
    parsed = [];
  }
  return { ...row, active: row.active === 1, seen_urls: parsed };
}

export class ArticleSourcesStore {
  constructor(private db: Database.Database) {}

  create(input: CreateArticleSourceInput): ArticleSource {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO article_sources
           (id, url, source_name, source_type, schedule_expr, cron_job_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.url,
        input.source_name,
        input.source_type,
        input.schedule_expr,
        input.cron_job_id ?? null
      );
    return this.getById(id)!;
  }

  getById(id: string): ArticleSource | null {
    const row = this.db.prepare('SELECT * FROM article_sources WHERE id = ?').get(id) as
      | ArticleSourceRow
      | undefined;
    return row ? rowToSource(row) : null;
  }

  getByCronJobId(cronJobId: number): ArticleSource | null {
    const row = this.db
      .prepare('SELECT * FROM article_sources WHERE cron_job_id = ?')
      .get(cronJobId) as ArticleSourceRow | undefined;
    return row ? rowToSource(row) : null;
  }

  getAll(): ArticleSource[] {
    const rows = this.db
      .prepare('SELECT * FROM article_sources ORDER BY created_at DESC, rowid DESC')
      .all() as ArticleSourceRow[];
    return rows.map(rowToSource);
  }

  getActive(): ArticleSource[] {
    const rows = this.db
      .prepare('SELECT * FROM article_sources WHERE active = 1 ORDER BY created_at DESC, rowid DESC')
      .all() as ArticleSourceRow[];
    return rows.map(rowToSource);
  }

  update(id: string, input: UpdateArticleSourceInput): ArticleSource | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.source_name !== undefined) {
      fields.push('source_name = ?');
      values.push(input.source_name);
    }
    if (input.schedule_expr !== undefined) {
      fields.push('schedule_expr = ?');
      values.push(input.schedule_expr);
    }
    if (input.cron_job_id !== undefined) {
      fields.push('cron_job_id = ?');
      values.push(input.cron_job_id);
    }
    if (input.active !== undefined) {
      fields.push('active = ?');
      values.push(input.active ? 1 : 0);
    }
    if (input.last_run_at !== undefined) {
      fields.push('last_run_at = ?');
      values.push(input.last_run_at);
    }
    if (input.last_status !== undefined) {
      fields.push('last_status = ?');
      values.push(input.last_status);
    }
    if (input.last_error !== undefined) {
      fields.push('last_error = ?');
      values.push(input.last_error);
    }
    if (input.seen_urls !== undefined) {
      fields.push('seen_urls = ?');
      values.push(JSON.stringify(input.seen_urls.slice(-SEEN_URL_LIMIT)));
    }

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
    values.push(id);

    this.db.prepare(`UPDATE article_sources SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM article_sources WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ============ Domain-specific ============

  /**
   * Add a URL to the seen-URLs ring buffer (caps at SEEN_URL_LIMIT, newest-first semantics preserved).
   * No-op if URL already present.
   */
  recordSeenUrls(id: string, newUrls: string[]): ArticleSource | null {
    const current = this.getById(id);
    if (!current) return null;
    const set = new Set(current.seen_urls);
    const merged = [...current.seen_urls];
    for (const u of newUrls) {
      if (!set.has(u)) {
        set.add(u);
        merged.push(u);
      }
    }
    const trimmed = merged.slice(-SEEN_URL_LIMIT);
    return this.update(id, { seen_urls: trimmed });
  }

  touchLastRun(
    id: string,
    status: Exclude<ArticleSourceStatus, null>,
    error?: string | null
  ): ArticleSource | null {
    return this.update(id, {
      last_run_at: new Date().toISOString(),
      last_status: status,
      last_error: error ?? null,
    });
  }
}
