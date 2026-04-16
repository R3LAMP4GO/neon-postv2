import crypto from 'crypto';
import Database from 'better-sqlite3';

// ============ Types ============

export interface BrandConfig {
  id: string;
  name: string;
  voice: string | null;
  tone: string | null;
  target_audience: string | null;
  themes: string | null;
  hashtags: string | null;
  posting_guidelines: string | null;
  visual_style: string | null;
  dos: string | null;
  donts: string | null;
  example_posts: string | null;
  metadata: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateBrandConfigInput {
  name: string;
  voice?: string | null;
  tone?: string | null;
  target_audience?: string | null;
  themes?: string | null;
  hashtags?: string | null;
  posting_guidelines?: string | null;
  visual_style?: string | null;
  dos?: string | null;
  donts?: string | null;
  example_posts?: string | null;
  metadata?: string | null;
}

export interface UpdateBrandConfigInput {
  name?: string;
  voice?: string | null;
  tone?: string | null;
  target_audience?: string | null;
  themes?: string | null;
  hashtags?: string | null;
  posting_guidelines?: string | null;
  visual_style?: string | null;
  dos?: string | null;
  donts?: string | null;
  example_posts?: string | null;
  metadata?: string | null;
  active?: boolean;
}

// ============ Schema ============

export const BRAND_CONFIG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS brand_config (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    voice TEXT,
    tone TEXT,
    target_audience TEXT,
    themes TEXT,
    hashtags TEXT,
    posting_guidelines TEXT,
    visual_style TEXT,
    dos TEXT,
    donts TEXT,
    example_posts TEXT,
    metadata TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ'))
  );

  CREATE INDEX IF NOT EXISTS idx_brand_config_active
    ON brand_config(active);
`;

// ============ CRUD Class ============

export class BrandConfigStore {
  constructor(private db: Database.Database) {}

  create(input: CreateBrandConfigInput): BrandConfig {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO brand_config
           (id, name, voice, tone, target_audience, themes, hashtags,
            posting_guidelines, visual_style, dos, donts, example_posts, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.voice ?? null,
        input.tone ?? null,
        input.target_audience ?? null,
        input.themes ?? null,
        input.hashtags ?? null,
        input.posting_guidelines ?? null,
        input.visual_style ?? null,
        input.dos ?? null,
        input.donts ?? null,
        input.example_posts ?? null,
        input.metadata ?? null
      );
    return this.getById(id)!;
  }

  getById(id: string): BrandConfig | null {
    const row = this.db.prepare('SELECT * FROM brand_config WHERE id = ?').get(id) as
      | (Omit<BrandConfig, 'active'> & { active: number })
      | undefined;
    return row ? { ...row, active: row.active === 1 } : null;
  }

  getAll(): BrandConfig[] {
    const rows = this.db.prepare('SELECT * FROM brand_config ORDER BY name').all() as Array<
      Omit<BrandConfig, 'active'> & { active: number }
    >;
    return rows.map((r) => ({ ...r, active: r.active === 1 }));
  }

  update(id: string, input: UpdateBrandConfigInput): BrandConfig | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      fields.push('name = ?');
      values.push(input.name);
    }
    if (input.voice !== undefined) {
      fields.push('voice = ?');
      values.push(input.voice);
    }
    if (input.tone !== undefined) {
      fields.push('tone = ?');
      values.push(input.tone);
    }
    if (input.target_audience !== undefined) {
      fields.push('target_audience = ?');
      values.push(input.target_audience);
    }
    if (input.themes !== undefined) {
      fields.push('themes = ?');
      values.push(input.themes);
    }
    if (input.hashtags !== undefined) {
      fields.push('hashtags = ?');
      values.push(input.hashtags);
    }
    if (input.posting_guidelines !== undefined) {
      fields.push('posting_guidelines = ?');
      values.push(input.posting_guidelines);
    }
    if (input.visual_style !== undefined) {
      fields.push('visual_style = ?');
      values.push(input.visual_style);
    }
    if (input.dos !== undefined) {
      fields.push('dos = ?');
      values.push(input.dos);
    }
    if (input.donts !== undefined) {
      fields.push('donts = ?');
      values.push(input.donts);
    }
    if (input.example_posts !== undefined) {
      fields.push('example_posts = ?');
      values.push(input.example_posts);
    }
    if (input.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(input.metadata);
    }
    if (input.active !== undefined) {
      fields.push('active = ?');
      values.push(input.active ? 1 : 0);
    }

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
    values.push(id);

    this.db.prepare(`UPDATE brand_config SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM brand_config WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ============ Domain-specific queries ============

  getByName(name: string): BrandConfig | null {
    const row = this.db.prepare('SELECT * FROM brand_config WHERE name = ?').get(name) as
      | (Omit<BrandConfig, 'active'> & { active: number })
      | undefined;
    return row ? { ...row, active: row.active === 1 } : null;
  }

  getActive(): BrandConfig | null {
    const row = this.db
      .prepare('SELECT * FROM brand_config WHERE active = 1 ORDER BY updated_at DESC LIMIT 1')
      .get() as (Omit<BrandConfig, 'active'> & { active: number }) | undefined;
    return row ? { ...row, active: row.active === 1 } : null;
  }

  getAllActive(): BrandConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM brand_config WHERE active = 1 ORDER BY name')
      .all() as Array<Omit<BrandConfig, 'active'> & { active: number }>;
    return rows.map((r) => ({ ...r, active: r.active === 1 }));
  }
}
