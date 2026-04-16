import fs from 'fs';
import path from 'path';
import { loadImage } from '@napi-rs/canvas';
import type { FetchedAsset } from './types';

// ---------------------------------------------------------------------------
// Local folder scanner — reads images from a user-specified directory
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

/**
 * Scans a local directory for image files and returns them as assets.
 *
 * @param dir   Absolute path to the directory to scan.
 * @param limit Maximum number of images to return (default 20).
 */
export async function scanLocalFolder(
  dir: string,
  limit: number = 20
): Promise<FetchedAsset[]> {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  });

  // Sort by modification time, newest first
  const sorted = entries
    .map((f) => {
      const fullPath = path.join(dir, f);
      return { name: f, path: fullPath, mtime: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  const assets: FetchedAsset[] = [];

  for (const entry of sorted) {
    let width = 0; // eslint-disable-line no-useless-assignment
    let height = 0; // eslint-disable-line no-useless-assignment
    try {
      const img = await loadImage(entry.path);
      width = img.width;
      height = img.height;
    } catch {
      // Skip files that can't be loaded as images
      continue;
    }

    assets.push({
      id: `local-${path.basename(entry.name, path.extname(entry.name))}`,
      source: 'local',
      localPath: entry.path,
      url: null,
      width,
      height,
      attribution: null,
    });
  }

  return assets;
}
