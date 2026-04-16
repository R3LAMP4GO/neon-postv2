import { proxyFetch } from '../utils/proxy-fetch';
import { SettingsManager } from '../settings';
import { downloadToCache } from './cache';
import type { FetchedAsset, AssetSearchOptions } from './types';

// ---------------------------------------------------------------------------
// Unsplash API client
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.unsplash.com';

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  user: { name: string };
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
  };
}

interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
  total: number;
  total_pages: number;
}

function getApiKey(): string {
  const key = SettingsManager.get('unsplash.apiKey');
  if (!key) throw new Error('Unsplash API key not configured. Set unsplash.apiKey in settings.');
  return key;
}

/**
 * Searches Unsplash for photos matching a query.
 * Downloads results to the local cache and returns asset metadata.
 */
export async function searchUnsplash(options: AssetSearchOptions): Promise<FetchedAsset[]> {
  const { query, orientation, count = 5 } = options;
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    query,
    per_page: String(Math.min(count, 30)),
  });
  if (orientation) params.set('orientation', orientation);

  const res = await proxyFetch(`${API_BASE}/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Unsplash API error: ${res.status} — ${body}`);
  }

  const data = (await res.json()) as UnsplashSearchResponse;

  const assets: FetchedAsset[] = [];
  for (const photo of data.results) {
    // Use the 'regular' size (1080px wide) — good balance of quality and speed
    const url = photo.urls.regular;
    const localPath = await downloadToCache(url, proxyFetch);
    assets.push({
      id: `unsplash-${photo.id}`,
      source: 'unsplash',
      localPath,
      url,
      width: photo.width,
      height: photo.height,
      attribution: photo.user.name,
    });
  }

  return assets;
}
