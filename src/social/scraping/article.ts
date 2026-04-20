/**
 * Article Extractor
 *
 * Turns a web URL into structured article JSON using Mozilla Readability + jsdom.
 * Handles three input shapes:
 *   1. Single article page   → one ArticleResult
 *   2. RSS/Atom feed         → N ArticleResult (one per feed item, body scraped per link)
 *   3. HTML index/section    → N ArticleResult (one per detected article link)
 *
 * Public API:
 *   detectSourceType(url)   — classify before add (optionally via initial fetch)
 *   scrapeArticle(url)      — fetch + Readability one URL
 *   scrapeSource(url, opts) — auto-dispatch by source type, return list
 */

import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import Parser from 'rss-parser';

import { proxyFetch } from '../../utils/proxy-fetch';
import { logError } from '../../utils/file-logger';

const LOG_PREFIX = '[scrape:article]';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ITEMS = 20;

// ── Types ──

export type SourceType = 'article' | 'feed' | 'index';

export interface ArticleResult {
  url: string;
  title: string;
  byline: string | null;
  excerpt: string | null;
  textContent: string;
  content: string;
  siteName: string;
  publishedTime: string | null;
  topImage: string | null;
  lang: string | null;
}

export interface ScrapeSourceOptions {
  /** Cap items returned for feed/index sources (default 20). */
  maxItems?: number;
  /** Restrict index-page link extraction to same-origin candidates (default true). */
  sameOriginOnly?: boolean;
}

export interface ScrapeSourceResult {
  sourceType: SourceType;
  items: ArticleResult[];
}

// ── Error ──

export class ArticleScrapeError extends Error {
  constructor(
    message: string,
    public readonly url?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'ArticleScrapeError';
  }
}

// ── Internals ──

async function fetchHtml(url: string): Promise<{ html: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await proxyFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new ArticleScrapeError(`HTTP ${res.status} for ${url}`, url, res.status);
      logError('article-scrape', 'fetch non-2xx', err, { url, status: res.status });
      throw err;
    }
    const contentType = res.headers.get('content-type') || '';
    const html = await res.text();
    return { html, contentType };
  } catch (err) {
    if (!(err instanceof ArticleScrapeError)) {
      logError('article-scrape', 'fetch failed', err, { url });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function buildDoc(html: string, url: string): Document {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', () => {});
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(html, { url, virtualConsole });
  return dom.window.document;
}

function deriveSiteName(doc: Document, url: string): string {
  const ogSite = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  if (ogSite && ogSite.trim()) return ogSite.trim();

  const appName = doc.querySelector('meta[name="application-name"]')?.getAttribute('content');
  if (appName && appName.trim()) return appName.trim();

  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, '');
    const rootLabel = host.split('.')[0];
    const section = pathname.split('/').filter(Boolean)[0];
    const left = rootLabel.charAt(0).toUpperCase() + rootLabel.slice(1);
    if (section && /^[a-z]+$/i.test(section)) {
      const right = section.charAt(0).toUpperCase() + section.slice(1);
      return `${left} ${right}`;
    }
    return left;
  } catch {
    return url;
  }
}

function extractMeta(doc: Document, name: string): string | null {
  const sels = [
    `meta[property="${name}"]`,
    `meta[name="${name}"]`,
    `meta[itemprop="${name}"]`,
  ];
  for (const sel of sels) {
    const v = doc.querySelector(sel)?.getAttribute('content');
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function parseReadability(doc: Document, url: string): ArticleResult {
  const reader = new Readability(doc.cloneNode(true) as Document);
  const parsed = reader.parse();
  if (!parsed || !parsed.textContent?.trim()) {
    throw new ArticleScrapeError('Readability returned no article content', url);
  }

  return {
    url,
    title: parsed.title?.trim() || doc.title?.trim() || url,
    byline: parsed.byline?.trim() || null,
    excerpt: parsed.excerpt?.trim() || null,
    textContent: parsed.textContent.trim(),
    content: parsed.content || '',
    siteName: deriveSiteName(doc, url),
    publishedTime:
      extractMeta(doc, 'article:published_time') ||
      extractMeta(doc, 'og:published_time') ||
      extractMeta(doc, 'datePublished'),
    topImage: extractMeta(doc, 'og:image') || extractMeta(doc, 'twitter:image'),
    lang: doc.documentElement.getAttribute('lang') || null,
  };
}

function looksLikeFeedContentType(ct: string): boolean {
  const lower = ct.toLowerCase();
  return (
    lower.includes('rss+xml') ||
    lower.includes('atom+xml') ||
    lower.includes('application/xml') ||
    lower.includes('text/xml')
  );
}

function findFeedLink(doc: Document): string | null {
  const link = doc.querySelector(
    'link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]'
  );
  return link?.getAttribute('href') || null;
}

function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractIndexLinks(doc: Document, baseUrl: string, sameOrigin: boolean): string[] {
  const base = new URL(baseUrl);
  const containers = doc.querySelectorAll('article a[href], section a[href], main a[href]');
  const seen = new Set<string>();
  const ordered: string[] = [];

  containers.forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (!href) return;
    const abs = absoluteUrl(href, baseUrl);
    if (!abs) return;
    try {
      const u = new URL(abs);
      if (sameOrigin && u.hostname !== base.hostname) return;
      // Heuristic: skip obvious non-article links (fragments, mailto, short paths)
      if (u.hash && u.pathname === base.pathname) return;
      if (!/^https?:$/.test(u.protocol)) return;
      const pathSegments = u.pathname.split('/').filter(Boolean);
      if (pathSegments.length < 2) return;
      if (seen.has(abs)) return;
      seen.add(abs);
      ordered.push(abs);
    } catch {
      /* noop */
    }
  });

  return ordered;
}

// ── Public API ──

/**
 * Fetch a URL and attempt to classify as article / feed / index.
 * Returns the classification plus the html payload so callers can re-use it.
 */
export async function detectSourceType(
  url: string
): Promise<{ sourceType: SourceType; html: string; doc: Document | null }> {
  const { html, contentType } = await fetchHtml(url);

  if (looksLikeFeedContentType(contentType)) {
    return { sourceType: 'feed', html, doc: null };
  }

  const doc = buildDoc(html, url);

  if (findFeedLink(doc)) {
    return { sourceType: 'feed', html, doc };
  }

  // Index vs article heuristic: index pages have many same-origin article links and
  // a short text body relative to link density.
  const links = extractIndexLinks(doc, url, true);
  const mainTextLen = (doc.body?.textContent || '').trim().length;
  if (links.length >= 5 && mainTextLen < 4000) {
    return { sourceType: 'index', html, doc };
  }
  return { sourceType: 'article', html, doc };
}

/**
 * Scrape a single article URL. Throws ArticleScrapeError on failure.
 */
export async function scrapeArticle(url: string): Promise<ArticleResult> {
  console.log(`${LOG_PREFIX} scrapeArticle: ${url}`);
  const { html } = await fetchHtml(url);
  const doc = buildDoc(html, url);
  return parseReadability(doc, url);
}

async function scrapeFeed(feedUrl: string, maxItems: number): Promise<ArticleResult[]> {
  const parser = new Parser({
    headers: { 'User-Agent': USER_AGENT },
    timeout: FETCH_TIMEOUT_MS,
  });
  const feed = await parser.parseURL(feedUrl);
  const items = (feed.items || []).slice(0, maxItems);
  const results: ArticleResult[] = [];
  for (const item of items) {
    const itemUrl = item.link;
    if (!itemUrl) continue;
    try {
      const art = await scrapeArticle(itemUrl);
      if (feed.title && !art.siteName) {
        art.siteName = feed.title;
      }
      results.push(art);
    } catch (err) {
      console.warn(`${LOG_PREFIX} feed item failed ${itemUrl}: ${(err as Error).message}`);
      logError('article-scrape', 'feed item failed', err, { feedUrl, itemUrl });
    }
  }
  return results;
}

async function scrapeIndex(
  indexUrl: string,
  doc: Document,
  maxItems: number,
  sameOrigin: boolean
): Promise<ArticleResult[]> {
  const links = extractIndexLinks(doc, indexUrl, sameOrigin).slice(0, maxItems);
  const results: ArticleResult[] = [];
  for (const link of links) {
    try {
      const art = await scrapeArticle(link);
      results.push(art);
    } catch (err) {
      console.warn(`${LOG_PREFIX} index link failed ${link}: ${(err as Error).message}`);
      logError('article-scrape', 'index link failed', err, { indexUrl, link });
    }
  }
  return results;
}

/**
 * Scrape a source URL (article / feed / index) and return all extracted articles.
 */
export async function scrapeSource(
  url: string,
  opts: ScrapeSourceOptions = {}
): Promise<ScrapeSourceResult> {
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;
  const sameOrigin = opts.sameOriginOnly ?? true;

  const detected = await detectSourceType(url);

  if (detected.sourceType === 'feed') {
    let feedUrl = url;
    if (detected.doc) {
      const alt = findFeedLink(detected.doc);
      if (alt) {
        const abs = absoluteUrl(alt, url);
        if (abs) feedUrl = abs;
      }
    }
    const items = await scrapeFeed(feedUrl, maxItems);
    return { sourceType: 'feed', items };
  }

  if (detected.sourceType === 'index' && detected.doc) {
    const items = await scrapeIndex(url, detected.doc, maxItems, sameOrigin);
    return { sourceType: 'index', items };
  }

  // Article path: we already have the doc from detection
  const doc = detected.doc ?? buildDoc(detected.html, url);
  const item = parseReadability(doc, url);
  return { sourceType: 'article', items: [item] };
}
