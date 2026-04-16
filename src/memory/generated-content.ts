import crypto from 'crypto';
import Database from 'better-sqlite3';

// ============ Types ============

export type GeneratedContentType =
  | 'caption'
  | 'hook'
  | 'thread'
  | 'script'
  | 'image_prompt'
  | 'image'
  | 'carousel'
  | 'story'
  | 'repurpose'
  | 'video';

export interface GeneratedContent {
  id: string;
  social_post_id: string | null;
  brand_config_id: string | null;
  content_type: GeneratedContentType;
  platform: string | null;
  prompt_used: string | null;
  output: string;
  media_url: string | null;
  rating: number | null;
  used: boolean;
  group_id: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateGeneratedContentInput {
  social_post_id?: string | null;
  brand_config_id?: string | null;
  content_type: GeneratedContentType;
  platform?: string | null;
  prompt_used?: string | null;
  output: string;
  media_url?: string | null;
  rating?: number | null;
  group_id?: string | null;
  metadata?: string | null;
}

export interface UpdateGeneratedContentInput {
  social_post_id?: string | null;
  brand_config_id?: string | null;
  content_type?: GeneratedContentType;
  platform?: string | null;
  prompt_used?: string | null;
  output?: string;
  media_url?: string | null;
  rating?: number | null;
  used?: boolean;
  group_id?: string | null;
  metadata?: string | null;
}

// ============ Schema ============

export const GENERATED_CONTENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS generated_content (
    id TEXT PRIMARY KEY,
    social_post_id TEXT REFERENCES social_posts(id) ON DELETE SET NULL,
    brand_config_id TEXT REFERENCES brand_config(id) ON DELETE SET NULL,
    content_type TEXT NOT NULL
      CHECK(content_type IN ('caption', 'hook', 'thread', 'script', 'image_prompt', 'image', 'carousel', 'story', 'repurpose', 'video')),
    platform TEXT,
    prompt_used TEXT,
    output TEXT NOT NULL,
    media_url TEXT,
    rating INTEGER,
    used INTEGER NOT NULL DEFAULT 0,
    group_id TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ'))
  );

  CREATE INDEX IF NOT EXISTS idx_generated_content_type
    ON generated_content(content_type);
  CREATE INDEX IF NOT EXISTS idx_generated_content_platform
    ON generated_content(platform);
  CREATE INDEX IF NOT EXISTS idx_generated_content_post
    ON generated_content(social_post_id);
  CREATE INDEX IF NOT EXISTS idx_generated_content_brand
    ON generated_content(brand_config_id);
  CREATE INDEX IF NOT EXISTS idx_generated_content_used
    ON generated_content(used);
`;

// ============ CRUD Class ============

export class GeneratedContentStore {
  constructor(private db: Database.Database) {}

  create(input: CreateGeneratedContentInput): GeneratedContent {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO generated_content
           (id, social_post_id, brand_config_id, content_type, platform,
            prompt_used, output, media_url, rating, group_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.social_post_id ?? null,
        input.brand_config_id ?? null,
        input.content_type,
        input.platform ?? null,
        input.prompt_used ?? null,
        input.output,
        input.media_url ?? null,
        input.rating ?? null,
        input.group_id ?? null,
        input.metadata ?? null
      );
    return this.getById(id)!;
  }

  getById(id: string): GeneratedContent | null {
    const row = this.db.prepare('SELECT * FROM generated_content WHERE id = ?').get(id) as
      | (Omit<GeneratedContent, 'used'> & { used: number })
      | undefined;
    return row ? { ...row, used: row.used === 1 } : null;
  }

  getAll(): GeneratedContent[] {
    const rows = this.db
      .prepare('SELECT * FROM generated_content ORDER BY created_at DESC')
      .all() as Array<Omit<GeneratedContent, 'used'> & { used: number }>;
    return rows.map((r) => ({ ...r, used: r.used === 1 }));
  }

  update(id: string, input: UpdateGeneratedContentInput): GeneratedContent | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.social_post_id !== undefined) {
      fields.push('social_post_id = ?');
      values.push(input.social_post_id);
    }
    if (input.brand_config_id !== undefined) {
      fields.push('brand_config_id = ?');
      values.push(input.brand_config_id);
    }
    if (input.content_type !== undefined) {
      fields.push('content_type = ?');
      values.push(input.content_type);
    }
    if (input.platform !== undefined) {
      fields.push('platform = ?');
      values.push(input.platform);
    }
    if (input.prompt_used !== undefined) {
      fields.push('prompt_used = ?');
      values.push(input.prompt_used);
    }
    if (input.output !== undefined) {
      fields.push('output = ?');
      values.push(input.output);
    }
    if (input.media_url !== undefined) {
      fields.push('media_url = ?');
      values.push(input.media_url);
    }
    if (input.rating !== undefined) {
      fields.push('rating = ?');
      values.push(input.rating);
    }
    if (input.used !== undefined) {
      fields.push('used = ?');
      values.push(input.used ? 1 : 0);
    }
    if (input.group_id !== undefined) {
      fields.push('group_id = ?');
      values.push(input.group_id);
    }
    if (input.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(input.metadata);
    }

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
    values.push(id);

    this.db
      .prepare(`UPDATE generated_content SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM generated_content WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ============ Domain-specific queries ============

  getByGroup(groupId: string): GeneratedContent[] {
    const rows = this.db
      .prepare('SELECT * FROM generated_content WHERE group_id = ? ORDER BY created_at ASC')
      .all(groupId) as Array<Omit<GeneratedContent, 'used'> & { used: number }>;
    return rows.map((r) => ({ ...r, used: r.used === 1 }));
  }

  getByType(contentType: GeneratedContentType): GeneratedContent[] {
    const rows = this.db
      .prepare('SELECT * FROM generated_content WHERE content_type = ? ORDER BY created_at DESC')
      .all(contentType) as Array<Omit<GeneratedContent, 'used'> & { used: number }>;
    return rows.map((r) => ({ ...r, used: r.used === 1 }));
  }

  getByPlatform(platform: string): GeneratedContent[] {
    const rows = this.db
      .prepare('SELECT * FROM generated_content WHERE platform = ? ORDER BY created_at DESC')
      .all(platform) as Array<Omit<GeneratedContent, 'used'> & { used: number }>;
    return rows.map((r) => ({ ...r, used: r.used === 1 }));
  }

  getByPost(socialPostId: string): GeneratedContent[] {
    const rows = this.db
      .prepare('SELECT * FROM generated_content WHERE social_post_id = ? ORDER BY created_at DESC')
      .all(socialPostId) as Array<Omit<GeneratedContent, 'used'> & { used: number }>;
    return rows.map((r) => ({ ...r, used: r.used === 1 }));
  }

  getByBrand(brandConfigId: string): GeneratedContent[] {
    const rows = this.db
      .prepare('SELECT * FROM generated_content WHERE brand_config_id = ? ORDER BY created_at DESC')
      .all(brandConfigId) as Array<Omit<GeneratedContent, 'used'> & { used: number }>;
    return rows.map((r) => ({ ...r, used: r.used === 1 }));
  }

  getUnused(contentType?: GeneratedContentType): GeneratedContent[] {
    const query = contentType
      ? 'SELECT * FROM generated_content WHERE used = 0 AND content_type = ? ORDER BY created_at DESC'
      : 'SELECT * FROM generated_content WHERE used = 0 ORDER BY created_at DESC';
    const params = contentType ? [contentType] : [];
    const rows = this.db.prepare(query).all(...params) as Array<
      Omit<GeneratedContent, 'used'> & { used: number }
    >;
    return rows.map((r) => ({ ...r, used: r.used === 1 }));
  }

  getTopRated(limit: number = 20): GeneratedContent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM generated_content
         WHERE rating IS NOT NULL
         ORDER BY rating DESC, created_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<Omit<GeneratedContent, 'used'> & { used: number }>;
    return rows.map((r) => ({ ...r, used: r.used === 1 }));
  }
}
