/**
 * Unit tests for the article extractor (src/social/scraping/article.ts).
 *
 * Covers:
 *  - scrapeArticle: Readability happy-path, HTTP errors, empty content
 *  - deriveSiteName: og:site_name + CNN-Sports-from-hostname fallback
 *  - detectSourceType: article vs index heuristic, feed via content-type, feed via <link rel=alternate>
 *  - scrapeSource: all three branches (article / feed / index)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock proxy-fetch before importing the module under test
const mockFetch = vi.fn();
vi.mock('../../src/utils/proxy-fetch', () => ({
  proxyFetch: (...args: unknown[]) => mockFetch(...args),
}));

// Mock rss-parser
const mockParseURL = vi.fn();
vi.mock('rss-parser', () => {
  return {
    default: class {
      async parseURL(url: string) {
        return mockParseURL(url);
      }
    },
  };
});

import {
  scrapeArticle,
  scrapeSource,
  detectSourceType,
  ArticleScrapeError,
} from '../../src/social/scraping/article';

function makeResponse(body: string, opts: { status?: number; contentType?: string } = {}) {
  const status = opts.status ?? 200;
  const headers = new Map<string, string>([['content-type', opts.contentType ?? 'text/html; charset=utf-8']]);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    text: async () => body,
  };
}

const CNN_SPORTS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Eagles drama: Philadelphia stuns the NFL | CNN Sports</title>
  <meta property="og:site_name" content="CNN">
  <meta property="og:image" content="https://cdn.cnn.com/eagles.jpg">
  <meta property="article:published_time" content="2026-04-20T12:00:00Z">
</head>
<body>
  <article>
    <h1>Eagles drama: Philadelphia stuns the NFL</h1>
    <p class="byline">By Jane Reporter</p>
    <p>In a shocking turn of events this Sunday, the Philadelphia Eagles rallied from a 20-point deficit against the Cowboys to clinch the division title in overtime. The comeback has already been called one of the most remarkable in franchise history by analysts and former players alike.</p>
    <p>Head coach Nick Sirianni praised his team's resilience after the game, highlighting the second-half adjustments that turned the momentum around. Jalen Hurts threw for three touchdowns and ran for another, silencing critics who had questioned his leadership after a tough stretch in the regular season.</p>
    <p>With this win, the Eagles secure home-field advantage throughout the playoffs and set up a potential showdown with the defending champions. Fans packed Lincoln Financial Field erupted at the final whistle, celebrating what many are already calling a defining moment for the franchise this decade.</p>
  </article>
</body>
</html>`;

const BBC_NEWS_HTML = `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <title>Major earthquake strikes coastal region - BBC News</title>
  <meta property="og:site_name" content="BBC News">
</head>
<body>
  <main>
    <article>
      <h1>Major earthquake strikes coastal region</h1>
      <p>A powerful magnitude 7.2 earthquake struck the coastal region early this morning, prompting widespread evacuations and damage assessments across multiple districts. Authorities reported that tsunami warnings were issued within minutes of the initial tremor.</p>
      <p>Emergency services have mobilized rescue teams to the most affected areas, where initial reports describe collapsed buildings and disrupted transportation links. Hospitals in neighboring cities have begun preparations to receive casualties.</p>
      <p>Geologists say aftershocks are likely to continue for several days, and residents have been urged to stay away from damaged structures until inspections are complete. The government has convened an emergency response meeting to coordinate relief efforts.</p>
    </article>
  </main>
</body>
</html>`;

const INDEX_PAGE_HTML = `<!DOCTYPE html>
<html>
<head><title>CNN Sports</title></head>
<body>
  <main>
    <article><a href="/sport/article/eagles-drama-2026">Eagles drama</a></article>
    <article><a href="/sport/article/lakers-win-2026">Lakers win</a></article>
    <article><a href="/sport/article/yankees-trade-2026">Yankees trade</a></article>
    <article><a href="/sport/article/f1-race-2026">F1 race</a></article>
    <article><a href="/sport/article/tennis-open-2026">Tennis open</a></article>
    <article><a href="/sport/article/boxing-match-2026">Boxing match</a></article>
    <article><a href="https://other.example/story">Off-origin</a></article>
  </main>
</body>
</html>`;

const FEED_HTML_WITH_ALTERNATE = `<!DOCTYPE html>
<html><head>
  <link rel="alternate" type="application/rss+xml" href="/rss.xml">
</head><body><main><p>Home</p></main></body></html>`;

const RSS_FEED_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Demo Feed</title>
  <item><title>Story One</title><link>https://example.com/s1</link></item>
  <item><title>Story Two</title><link>https://example.com/s2</link></item>
</channel></rss>`;

beforeEach(() => {
  mockFetch.mockReset();
  mockParseURL.mockReset();
});

// ── scrapeArticle ─────────────────────────────────────────────

describe('scrapeArticle', () => {
  it('extracts title, body, siteName, image, publishedTime from CNN-like HTML', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(CNN_SPORTS_HTML));
    const art = await scrapeArticle('https://www.cnn.com/sport/article/eagles-drama-2026');

    expect(art.title).toMatch(/Eagles drama/);
    expect(art.textContent).toContain('Philadelphia Eagles');
    expect(art.textContent).toContain('Sirianni');
    expect(art.siteName).toBe('CNN');
    expect(art.topImage).toBe('https://cdn.cnn.com/eagles.jpg');
    expect(art.publishedTime).toBe('2026-04-20T12:00:00Z');
    expect(art.lang).toBe('en');
    expect(art.url).toBe('https://www.cnn.com/sport/article/eagles-drama-2026');
  });

  it('derives siteName from og:site_name when present (BBC)', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(BBC_NEWS_HTML));
    const art = await scrapeArticle('https://www.bbc.co.uk/news/earthquake-2026');
    expect(art.siteName).toBe('BBC News');
    expect(art.lang).toBe('en-GB');
  });

  it('derives siteName from hostname+section when og:site_name missing ("CNN Sports" from cnn.com/sport)', async () => {
    const htmlNoOg = CNN_SPORTS_HTML.replace(
      '<meta property="og:site_name" content="CNN">',
      ''
    );
    mockFetch.mockResolvedValueOnce(makeResponse(htmlNoOg));
    const art = await scrapeArticle('https://www.cnn.com/sport/article/eagles-drama-2026');
    expect(art.siteName).toBe('Cnn Sport');
  });

  it('throws ArticleScrapeError on HTTP 403 (paywall)', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse('forbidden', { status: 403 }));
    await expect(scrapeArticle('https://wsj.com/paywalled')).rejects.toBeInstanceOf(
      ArticleScrapeError
    );
  });

  it('throws ArticleScrapeError when Readability returns no content', async () => {
    // No text content anywhere — Readability returns null / empty textContent
    mockFetch.mockResolvedValueOnce(
      makeResponse(
        '<html><head><title></title></head><body><script>var x=1;</script></body></html>'
      )
    );
    await expect(scrapeArticle('https://example.com/empty')).rejects.toBeInstanceOf(
      ArticleScrapeError
    );
  });
});

// ── detectSourceType ──────────────────────────────────────────

describe('detectSourceType', () => {
  it('returns feed when Content-Type indicates RSS', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(RSS_FEED_XML, { contentType: 'application/rss+xml' })
    );
    const res = await detectSourceType('https://example.com/rss.xml');
    expect(res.sourceType).toBe('feed');
  });

  it('returns feed when HTML has <link rel=alternate type=rss>', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(FEED_HTML_WITH_ALTERNATE));
    const res = await detectSourceType('https://example.com/');
    expect(res.sourceType).toBe('feed');
  });

  it('returns article for a story page with long body + few links', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(CNN_SPORTS_HTML));
    const res = await detectSourceType('https://www.cnn.com/sport/article/eagles-drama-2026');
    expect(res.sourceType).toBe('article');
  });

  it('returns index for a section page with many same-origin links', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(INDEX_PAGE_HTML));
    const res = await detectSourceType('https://www.cnn.com/sport');
    expect(res.sourceType).toBe('index');
  });
});

// ── scrapeSource ──────────────────────────────────────────────

describe('scrapeSource', () => {
  it('article path returns exactly one item', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(CNN_SPORTS_HTML));
    const res = await scrapeSource('https://www.cnn.com/sport/article/eagles-drama-2026');
    expect(res.sourceType).toBe('article');
    expect(res.items).toHaveLength(1);
    expect(res.items[0].title).toMatch(/Eagles drama/);
  });

  it('feed path scrapes each feed item via per-item HTTP fetch', async () => {
    // First call: detectSourceType fetches the feed URL
    mockFetch.mockResolvedValueOnce(
      makeResponse(RSS_FEED_XML, { contentType: 'application/rss+xml' })
    );
    // rss-parser resolves items
    mockParseURL.mockResolvedValueOnce({
      title: 'Demo Feed',
      items: [
        { title: 'Story One', link: 'https://example.com/s1' },
        { title: 'Story Two', link: 'https://example.com/s2' },
      ],
    });
    // Two follow-up fetches for each story
    mockFetch.mockResolvedValueOnce(makeResponse(CNN_SPORTS_HTML));
    mockFetch.mockResolvedValueOnce(makeResponse(BBC_NEWS_HTML));

    const res = await scrapeSource('https://example.com/feed', { maxItems: 5 });
    expect(res.sourceType).toBe('feed');
    expect(res.items.length).toBe(2);
  });

  it('index path extracts same-origin links and scrapes each', async () => {
    // Detection + initial doc: index with many article links
    mockFetch.mockResolvedValueOnce(makeResponse(INDEX_PAGE_HTML));
    // Mock each per-link fetch to return a short article
    for (let i = 0; i < 6; i++) {
      mockFetch.mockResolvedValueOnce(makeResponse(BBC_NEWS_HTML));
    }
    const res = await scrapeSource('https://www.cnn.com/sport', {
      maxItems: 6,
      sameOriginOnly: true,
    });
    expect(res.sourceType).toBe('index');
    expect(res.items.length).toBe(6);
    // Off-origin link should have been filtered out
    expect(res.items.every((a) => a.url.startsWith('https://www.cnn.com/'))).toBe(true);
  });
});
