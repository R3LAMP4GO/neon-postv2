import { proxyFetch } from '../utils/proxy-fetch';
import { SettingsManager } from '../settings';
import { downloadToCache } from './cache';
import type { FetchedAsset, AssetSearchOptions } from './types';

// ---------------------------------------------------------------------------
// Pexels API client
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.pexels.com/v1';

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  photographer: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
  };
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
  total_results: number;
  page: number;
  per_page: number;
}

function getApiKey(): string {
  const key = SettingsManager.get('pexels.apiKey');
  if (!key) throw new Error('Pexels API key not configured. Set pexels.apiKey in settings.');
  return key;
}

/**
 * Searches Pexels for photos matching a query.
 * Downloads results to the local cache and returns asset metadata.
 */
export async function searchPexels(options: AssetSearchOptions): Promise<FetchedAsset[]> {
  const { query, orientation, count = 5, minWidth = 1080 } = options;
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    query,
    per_page: String(Math.min(count, 40)),
    size: 'large',
  });
  if (orientation) params.set('orientation', orientation);

  const res = await proxyFetch(`${API_BASE}/search?${params}`, {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pexels API error: ${res.status} — ${body}`);
  }

  const data = (await res.json()) as PexelsSearchResponse;

  const assets: FetchedAsset[] = [];
  for (const photo of data.photos) {
    // Pick the best resolution that's at least minWidth
    const url = photo.width >= minWidth * 2 ? photo.src.large2x : photo.src.large;

    const localPath = await downloadToCache(url, proxyFetch);
    assets.push({
      id: `pexels-${photo.id}`,
      source: 'pexels',
      localPath,
      url,
      width: photo.width,
      height: photo.height,
      attribution: photo.photographer,
    });
  }

  return assets;
}

/**
 * Fetches a curated set of photos (no search query needed).
 */
export async function curatedPexels(count: number = 10): Promise<FetchedAsset[]> {
  const apiKey = getApiKey();

  const res = await proxyFetch(`${API_BASE}/curated?per_page=${Math.min(count, 40)}`, {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) throw new Error(`Pexels curated error: ${res.status}`);

  const data = (await res.json()) as PexelsSearchResponse;

  const assets: FetchedAsset[] = [];
  for (const photo of data.photos) {
    const localPath = await downloadToCache(photo.src.large2x, proxyFetch);
    assets.push({
      id: `pexels-${photo.id}`,
      source: 'pexels',
      localPath,
      url: photo.src.large2x,
      width: photo.width,
      height: photo.height,
      attribution: photo.photographer,
    });
  }

  return assets;
}
