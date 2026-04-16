// ---------------------------------------------------------------------------
// Asset sourcing types
// ---------------------------------------------------------------------------

export type AssetSource = 'pexels' | 'unsplash' | 'local' | 'kie';

export interface FetchedAsset {
  /** Unique identifier (URL or file path). */
  id: string;
  /** Where the asset came from. */
  source: AssetSource;
  /** Local file path (after download/cache). */
  localPath: string;
  /** Original URL (null for local assets). */
  url: string | null;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Photographer / attribution (for stock images). */
  attribution: string | null;
}

export interface AssetSearchOptions {
  /** Search query (e.g. "business meeting", "technology abstract"). */
  query: string;
  /** Preferred orientation. */
  orientation?: 'landscape' | 'portrait' | 'square';
  /** Number of results to return. */
  count?: number;
  /** Minimum width in pixels. */
  minWidth?: number;
}
