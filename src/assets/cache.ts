import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';

// ---------------------------------------------------------------------------
// Asset cache — downloads remote images to a local directory
// ---------------------------------------------------------------------------

function getCacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'asset-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Returns a deterministic local path for a given URL.
 * If the file already exists, returns it immediately (cache hit).
 */
export function getCachedPath(url: string, ext: string = '.jpg'): string {
  const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  return path.join(getCacheDir(), `${hash}${ext}`);
}

/**
 * Downloads a URL to the cache directory if not already present.
 * Returns the local file path.
 */
export async function downloadToCache(
  url: string,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const ext = path.extname(new URL(url).pathname) || '.jpg';
  const localPath = getCachedPath(url, ext);

  if (fs.existsSync(localPath)) return localPath;

  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to download asset: ${res.status} ${url}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(localPath, buffer);
  return localPath;
}

/**
 * Clears cached assets older than `maxAgeMs` (default 7 days).
 */
export function pruneCache(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
  const dir = getCacheDir();
  const now = Date.now();
  let pruned = 0;

  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (now - stat.mtimeMs > maxAgeMs) {
      fs.unlinkSync(filePath);
      pruned++;
    }
  }

  return pruned;
}
