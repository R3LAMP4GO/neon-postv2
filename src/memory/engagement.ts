import crypto from 'crypto';
import Database from 'better-sqlite3';

// ============ Types ============

export type EngagementAction = 'reply' | 'like' | 'repost' | 'quote' | 'follow' | 'dm';

export interface EngagementLog {
  id: string;
  social_account_id: string | null;
  social_post_id: string | null;
  platform: string;
  action: EngagementAction;
  target_user: string | null;
  target_url: string | null;
  content: string | null;
  external_id: string | null;
  success: boolean;
  error: string | null;
  metadata: string | null;
  created_at: string;
}

export interface CreateEngagementLogInput {
  social_account_id?: string | null;
  social_post_id?: string | null;
  platform: string;
  action: EngagementAction;
  target_user?: string | null;
  target_url?: string | null;
  content?: string | null;
  external_id?: string | null;
  success?: boolean;
  error?: string | null;
  metadata?: string | null;
}

export interface UpdateEngagementLogInput {
  social_account_id?: string | null;
  social_post_id?: string | null;
  platform?: string;
  action?: EngagementAction;
  target_user?: string | null;
  target_url?: string | null;
  content?: string | null;
  external_id?: string | null;
  success?: boolean;
  error?: string | null;
  metadata?: string | null;
}

// ============ Schema ============

export const ENGAGEMENT_LOG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS engagement_log (
    id TEXT PRIMARY KEY,
    social_account_id TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
    social_post_id TEXT REFERENCES social_posts(id) ON DELETE SET NULL,
    platform TEXT NOT NULL,
    action TEXT NOT NULL
      CHECK(action IN ('reply', 'like', 'repost', 'quote', 'follow', 'dm')),
    target_user TEXT,
    target_url TEXT,
    content TEXT,
    external_id TEXT,
    success INTEGER NOT NULL DEFAULT 1,
    error TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ'))
  );

  CREATE INDEX IF NOT EXISTS idx_engagement_log_platform
    ON engagement_log(platform);
  CREATE INDEX IF NOT EXISTS idx_engagement_log_action
    ON engagement_log(action);
  CREATE INDEX IF NOT EXISTS idx_engagement_log_created_at
    ON engagement_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_engagement_log_account
    ON engagement_log(social_account_id);
  CREATE INDEX IF NOT EXISTS idx_engagement_log_post
    ON engagement_log(social_post_id);
`;

// ============ CRUD Class ============

export class EngagementLogStore {
  constructor(private db: Database.Database) {}

  create(input: CreateEngagementLogInput): EngagementLog {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO engagement_log
           (id, social_account_id, social_post_id, platform, action,
            target_user, target_url, content, external_id, success, error, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.social_account_id ?? null,
        input.social_post_id ?? null,
        input.platform,
        input.action,
        input.target_user ?? null,
        input.target_url ?? null,
        input.content ?? null,
        input.external_id ?? null,
        input.success !== false ? 1 : 0,
        input.error ?? null,
        input.metadata ?? null
      );
    return this.getById(id)!;
  }

  getById(id: string): EngagementLog | null {
    const row = this.db.prepare('SELECT * FROM engagement_log WHERE id = ?').get(id) as
      | (Omit<EngagementLog, 'success'> & { success: number })
      | undefined;
    return row ? { ...row, success: row.success === 1 } : null;
  }

  getAll(): EngagementLog[] {
    const rows = this.db
      .prepare('SELECT * FROM engagement_log ORDER BY created_at DESC')
      .all() as Array<Omit<EngagementLog, 'success'> & { success: number }>;
    return rows.map((r) => ({ ...r, success: r.success === 1 }));
  }

  update(id: string, input: UpdateEngagementLogInput): EngagementLog | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.social_account_id !== undefined) {
      fields.push('social_account_id = ?');
      values.push(input.social_account_id);
    }
    if (input.social_post_id !== undefined) {
      fields.push('social_post_id = ?');
      values.push(input.social_post_id);
    }
    if (input.platform !== undefined) {
      fields.push('platform = ?');
      values.push(input.platform);
    }
    if (input.action !== undefined) {
      fields.push('action = ?');
      values.push(input.action);
    }
    if (input.target_user !== undefined) {
      fields.push('target_user = ?');
      values.push(input.target_user);
    }
    if (input.target_url !== undefined) {
      fields.push('target_url = ?');
      values.push(input.target_url);
    }
    if (input.content !== undefined) {
      fields.push('content = ?');
      values.push(input.content);
    }
    if (input.external_id !== undefined) {
      fields.push('external_id = ?');
      values.push(input.external_id);
    }
    if (input.success !== undefined) {
      fields.push('success = ?');
      values.push(input.success ? 1 : 0);
    }
    if (input.error !== undefined) {
      fields.push('error = ?');
      values.push(input.error);
    }
    if (input.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(input.metadata);
    }

    if (fields.length === 0) return this.getById(id);

    values.push(id);

    this.db.prepare(`UPDATE engagement_log SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM engagement_log WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ============ Domain-specific queries ============

  getByPlatform(platform: string): EngagementLog[] {
    const rows = this.db
      .prepare('SELECT * FROM engagement_log WHERE platform = ? ORDER BY created_at DESC')
      .all(platform) as Array<Omit<EngagementLog, 'success'> & { success: number }>;
    return rows.map((r) => ({ ...r, success: r.success === 1 }));
  }

  getByAction(action: EngagementAction): EngagementLog[] {
    const rows = this.db
      .prepare('SELECT * FROM engagement_log WHERE action = ? ORDER BY created_at DESC')
      .all(action) as Array<Omit<EngagementLog, 'success'> & { success: number }>;
    return rows.map((r) => ({ ...r, success: r.success === 1 }));
  }

  getByPost(socialPostId: string): EngagementLog[] {
    const rows = this.db
      .prepare('SELECT * FROM engagement_log WHERE social_post_id = ? ORDER BY created_at DESC')
      .all(socialPostId) as Array<Omit<EngagementLog, 'success'> & { success: number }>;
    return rows.map((r) => ({ ...r, success: r.success === 1 }));
  }

  getByAccount(socialAccountId: string): EngagementLog[] {
    const rows = this.db
      .prepare('SELECT * FROM engagement_log WHERE social_account_id = ? ORDER BY created_at DESC')
      .all(socialAccountId) as Array<Omit<EngagementLog, 'success'> & { success: number }>;
    return rows.map((r) => ({ ...r, success: r.success === 1 }));
  }

  getRecent(limit: number = 50): EngagementLog[] {
    const rows = this.db
      .prepare('SELECT * FROM engagement_log ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Omit<EngagementLog, 'success'> & { success: number }>;
    return rows.map((r) => ({ ...r, success: r.success === 1 }));
  }

  countByAction(platform?: string): Array<{ action: string; count: number }> {
    const query = platform
      ? 'SELECT action, COUNT(*) as count FROM engagement_log WHERE platform = ? GROUP BY action'
      : 'SELECT action, COUNT(*) as count FROM engagement_log GROUP BY action';
    const params = platform ? [platform] : [];
    return this.db.prepare(query).all(...params) as Array<{ action: string; count: number }>;
  }
}
