import crypto from 'crypto';
import Database from 'better-sqlite3';

// ============ Types ============

export interface SocialAccount {
  id: string;
  platform: string;
  account_name: string;
  display_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  metadata: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateSocialAccountInput {
  platform: string;
  account_name: string;
  display_name?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expires_at?: string | null;
  scopes?: string | null;
  metadata?: string | null;
}

export interface UpdateSocialAccountInput {
  platform?: string;
  account_name?: string;
  display_name?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expires_at?: string | null;
  scopes?: string | null;
  metadata?: string | null;
  active?: boolean;
}

// ============ Schema ============

export const SOCIAL_ACCOUNTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    account_name TEXT NOT NULL,
    display_name TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TEXT,
    scopes TEXT,
    metadata TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_social_accounts_platform_name
    ON social_accounts(platform, account_name);
  CREATE INDEX IF NOT EXISTS idx_social_accounts_platform
    ON social_accounts(platform);
`;

// ============ CRUD Class ============

export class SocialAccountsStore {
  constructor(private db: Database.Database) {}

  create(input: CreateSocialAccountInput): SocialAccount {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO social_accounts
           (id, platform, account_name, display_name, access_token, refresh_token,
            token_expires_at, scopes, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.platform,
        input.account_name,
        input.display_name ?? null,
        input.access_token ?? null,
        input.refresh_token ?? null,
        input.token_expires_at ?? null,
        input.scopes ?? null,
        input.metadata ?? null
      );
    return this.getById(id)!;
  }

  getById(id: string): SocialAccount | null {
    const row = this.db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(id) as
      | (Omit<SocialAccount, 'active'> & { active: number })
      | undefined;
    return row ? { ...row, active: row.active === 1 } : null;
  }

  getAll(): SocialAccount[] {
    const rows = this.db
      .prepare('SELECT * FROM social_accounts ORDER BY platform, account_name')
      .all() as Array<Omit<SocialAccount, 'active'> & { active: number }>;
    return rows.map((r) => ({ ...r, active: r.active === 1 }));
  }

  update(id: string, input: UpdateSocialAccountInput): SocialAccount | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.platform !== undefined) {
      fields.push('platform = ?');
      values.push(input.platform);
    }
    if (input.account_name !== undefined) {
      fields.push('account_name = ?');
      values.push(input.account_name);
    }
    if (input.display_name !== undefined) {
      fields.push('display_name = ?');
      values.push(input.display_name);
    }
    if (input.access_token !== undefined) {
      fields.push('access_token = ?');
      values.push(input.access_token);
    }
    if (input.refresh_token !== undefined) {
      fields.push('refresh_token = ?');
      values.push(input.refresh_token);
    }
    if (input.token_expires_at !== undefined) {
      fields.push('token_expires_at = ?');
      values.push(input.token_expires_at);
    }
    if (input.scopes !== undefined) {
      fields.push('scopes = ?');
      values.push(input.scopes);
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

    this.db.prepare(`UPDATE social_accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM social_accounts WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ============ Domain-specific queries ============

  getByPlatform(platform: string): SocialAccount[] {
    const rows = this.db
      .prepare('SELECT * FROM social_accounts WHERE platform = ? ORDER BY account_name')
      .all(platform) as Array<Omit<SocialAccount, 'active'> & { active: number }>;
    return rows.map((r) => ({ ...r, active: r.active === 1 }));
  }

  getByPlatformAndName(platform: string, accountName: string): SocialAccount | null {
    const row = this.db
      .prepare('SELECT * FROM social_accounts WHERE platform = ? AND account_name = ?')
      .get(platform, accountName) as
      | (Omit<SocialAccount, 'active'> & { active: number })
      | undefined;
    return row ? { ...row, active: row.active === 1 } : null;
  }

  getActive(): SocialAccount[] {
    const rows = this.db
      .prepare('SELECT * FROM social_accounts WHERE active = 1 ORDER BY platform, account_name')
      .all() as Array<Omit<SocialAccount, 'active'> & { active: number }>;
    return rows.map((r) => ({ ...r, active: r.active === 1 }));
  }
}
