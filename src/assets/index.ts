export { searchPexels, curatedPexels } from './pexels';
export { searchUnsplash } from './unsplash';
export { scanLocalFolder } from './local';
export { downloadToCache, getCachedPath, pruneCache } from './cache';
export type { AssetSource, FetchedAsset, AssetSearchOptions } from './types';

import { searchPexels } from './pexels';
import { searchUnsplash } from './unsplash';
import { scanLocalFolder } from './local';
import type { FetchedAsset, AssetSearchOptions, AssetSource } from './types';

// ---------------------------------------------------------------------------
// Unified asset fetcher
// ---------------------------------------------------------------------------

/**
 * Fetches background images from the specified source.
 *
 * Usage:
 *   const assets = await getBackgrounds('pexels', { query: 'business meeting' });
 *   const localAssets = await getBackgrounds('local', { query: '/path/to/folder' });
 */
export async function getBackgrounds(
  source: AssetSource,
  options: AssetSearchOptions
): Promise<FetchedAsset[]> {
  switch (source) {
    case 'pexels':
      return searchPexels(options);
    case 'unsplash':
      return searchUnsplash(options);
    case 'local':
      // For local, `query` is the folder path
      return scanLocalFolder(options.query, options.count ?? 20);
    case 'kie':
      // Kie.ai images are handled by the existing image module
      // Return empty — caller should use KieClient directly
      return [];
  }
}
