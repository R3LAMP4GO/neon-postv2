import crypto from 'crypto';
import Database from 'better-sqlite3';

// ============ Types ============

export type SocialPostStatus = 'draft' | 'scheduled' | 'posting' | 'posted' | 'failed';

export interface MediaItem {
  path: string;
  type: 'image' | 'video';
  name: string;
}

export interface SocialPost {
  id: string;
  social_account_id: string | null;
  platform: string;
  status: SocialPostStatus;
  content: string;
  media_urls: string | null;
  scheduled_at: string | null;
  posted_at: string | null;
  external_post_id: string | null;
  external_url: string | null;
  error: string | null;
  video_path: string | null;
  video_url: string | null;
  transcript: string | null;
  generated_content_id: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  metadata: string | null;
  source_content_id: string | null;
  media_items: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSocialPostInput {
  social_account_id?: string | null;
  platform: string;
  status?: SocialPostStatus;
  content: string;
  media_urls?: string | null;
  scheduled_at?: string | null;
  metadata?: string | null;
  source_content_id?: string | null;
  video_path?: string | null;
  video_url?: string | null;
  transcript?: string | null;
  generated_content_id?: string | null;
  media_items?: string | null;
}

export interface UpdateSocialPostInput {
  social_account_id?: string | null;
  platform?: string;
  status?: SocialPostStatus;
  content?: string;
  media_urls?: string | null;
  scheduled_at?: string | null;
  posted_at?: string | null;
  external_post_id?: string | null;
  external_url?: string | null;
  error?: string | null;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  metadata?: string | null;
  video_path?: string | null;
  video_url?: string | null;
  transcript?: string | null;
  generated_content_id?: string | null;
  media_items?: string | null;
}

// ============ Schema ============

export const SOCIAL_POSTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS social_posts (
    id TEXT PRIMARY KEY,
    social_account_id TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK(status IN ('draft', 'scheduled', 'posting', 'posted', 'failed')),
    content TEXT NOT NULL,
    media_urls TEXT,
    scheduled_at TEXT,
    posted_at TEXT,
    external_post_id TEXT,
    external_url TEXT,
    error TEXT,
    video_path TEXT,
    video_url TEXT,
    transcript TEXT,
    generated_content_id TEXT,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    metadata TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ'))
  );

  CREATE INDEX IF NOT EXISTS idx_social_posts_status
    ON social_posts(status);
  CREATE INDEX IF NOT EXISTS idx_social_posts_platform
    ON social_posts(platform);
  CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled_at
    ON social_posts(scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_social_posts_account
    ON social_posts(social_account_id);
`;

// ============ CRUD Class ============

export class SocialPostsStore {
  constructor(private db: Database.Database) {}

  create(input: CreateSocialPostInput): SocialPost {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO social_posts
           (id, social_account_id, platform, status, content, media_urls, scheduled_at, metadata, source_content_id, video_path, video_url, transcript, generated_content_id, media_items)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.social_account_id ?? null,
        input.platform,
        input.status ?? 'draft',
        input.content,
        input.media_urls ?? null,
        input.scheduled_at ?? null,
        input.metadata ?? null,
        input.source_content_id ?? null,
        input.video_path ?? null,
        input.video_url ?? null,
        input.transcript ?? null,
        input.generated_content_id ?? null,
        input.media_items ?? null
      );
    return this.getById(id)!;
  }

  getById(id: string): SocialPost | null {
    const row = this.db.prepare('SELECT * FROM social_posts WHERE id = ?').get(id) as
      | SocialPost
      | undefined;
    return row ?? null;
  }

  getAll(): SocialPost[] {
    return this.db
      .prepare('SELECT * FROM social_posts ORDER BY created_at DESC')
      .all() as SocialPost[];
  }

  update(id: string, input: UpdateSocialPostInput): SocialPost | null {
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
    if (input.status !== undefined) {
      fields.push('status = ?');
      values.push(input.status);
    }
    if (input.content !== undefined) {
      fields.push('content = ?');
      values.push(input.content);
    }
    if (input.media_urls !== undefined) {
      fields.push('media_urls = ?');
      values.push(input.media_urls);
    }
    if (input.scheduled_at !== undefined) {
      fields.push('scheduled_at = ?');
      values.push(input.scheduled_at);
    }
    if (input.posted_at !== undefined) {
      fields.push('posted_at = ?');
      values.push(input.posted_at);
    }
    if (input.external_post_id !== undefined) {
      fields.push('external_post_id = ?');
      values.push(input.external_post_id);
    }
    if (input.external_url !== undefined) {
      fields.push('external_url = ?');
      values.push(input.external_url);
    }
    if (input.error !== undefined) {
      fields.push('error = ?');
      values.push(input.error);
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
    if (input.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(input.metadata);
    }
    if (input.video_path !== undefined) {
      fields.push('video_path = ?');
      values.push(input.video_path);
    }
    if (input.video_url !== undefined) {
      fields.push('video_url = ?');
      values.push(input.video_url);
    }
    if (input.transcript !== undefined) {
      fields.push('transcript = ?');
      values.push(input.transcript);
    }
    if (input.generated_content_id !== undefined) {
      fields.push('generated_content_id = ?');
      values.push(input.generated_content_id);
    }
    if (input.media_items !== undefined) {
      fields.push('media_items = ?');
      values.push(input.media_items);
    }

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
    values.push(id);

    this.db.prepare(`UPDATE social_posts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM social_posts WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ============ Domain-specific queries ============

  getByStatus(status: SocialPostStatus): SocialPost[] {
    return this.db
      .prepare('SELECT * FROM social_posts WHERE status = ? ORDER BY created_at DESC')
      .all(status) as SocialPost[];
  }

  getByPlatform(platform: string): SocialPost[] {
    return this.db
      .prepare('SELECT * FROM social_posts WHERE platform = ? ORDER BY created_at DESC')
      .all(platform) as SocialPost[];
  }

  getScheduled(): SocialPost[] {
    return this.db
      .prepare(
        `SELECT * FROM social_posts
         WHERE status = 'scheduled' AND scheduled_at IS NOT NULL
         ORDER BY scheduled_at ASC`
      )
      .all() as SocialPost[];
  }

  getDueForPosting(): SocialPost[] {
    return this.db
      .prepare(
        `SELECT * FROM social_posts
         WHERE status = 'scheduled'
           AND scheduled_at IS NOT NULL
           AND scheduled_at <= (strftime('%Y-%m-%dT%H:%M:%fZ'))
         ORDER BY scheduled_at ASC`
      )
      .all() as SocialPost[];
  }

  getDrafts(): SocialPost[] {
    return this.db
      .prepare("SELECT * FROM social_posts WHERE status = 'draft' ORDER BY created_at DESC")
      .all() as SocialPost[];
  }

  getByAccount(socialAccountId: string): SocialPost[] {
    return this.db
      .prepare('SELECT * FROM social_posts WHERE social_account_id = ? ORDER BY created_at DESC')
      .all(socialAccountId) as SocialPost[];
  }

  getInDateRange(startDate: string, endDate: string): SocialPost[] {
    return this.db
      .prepare(
        `SELECT * FROM social_posts
         WHERE (
           (status IN ('scheduled', 'posting') AND scheduled_at >= ? AND scheduled_at < ?)
           OR (status = 'posted' AND posted_at >= ? AND posted_at < ?)
           OR (status IN ('draft', 'failed') AND created_at >= ? AND created_at < ?)
         )
         ORDER BY COALESCE(scheduled_at, posted_at, created_at) ASC`
      )
      .all(startDate, endDate, startDate, endDate, startDate, endDate) as SocialPost[];
  }

  getPostCountByDay(
    startDate: string,
    endDate: string
  ): { date: string; count: number; platforms: string[] }[] {
    const rows = this.db
      .prepare(
        `SELECT
           DATE(COALESCE(
             CASE WHEN status IN ('scheduled', 'posting') THEN scheduled_at END,
             CASE WHEN status = 'posted' THEN posted_at END,
             created_at
           )) AS date,
           COUNT(*) AS count,
           GROUP_CONCAT(DISTINCT platform) AS platforms
         FROM social_posts
         WHERE (
           (status IN ('scheduled', 'posting') AND scheduled_at >= ? AND scheduled_at < ?)
           OR (status = 'posted' AND posted_at >= ? AND posted_at < ?)
           OR (status IN ('draft', 'failed') AND created_at >= ? AND created_at < ?)
         )
         GROUP BY date
         ORDER BY date ASC`
      )
      .all(startDate, endDate, startDate, endDate, startDate, endDate) as Array<{
      date: string;
      count: number;
      platforms: string;
    }>;

    return rows.map((row) => ({
      date: row.date,
      count: row.count,
      platforms: row.platforms ? row.platforms.split(',') : [],
    }));
  }

  updateSchedule(id: string, scheduledAt: string): SocialPost | null {
    return this.update(id, { scheduled_at: scheduledAt, status: 'scheduled' });
  }
}
