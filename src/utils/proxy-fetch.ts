/**
 * Proxy-Aware Fetch
 *
 * Drop-in replacement for global `fetch()` that routes requests through
 * the configured HTTP proxy when `proxy.url` is set in SettingsManager.
 *
 * Also reads standard environment variables (http_proxy, https_proxy,
 * HTTP_PROXY, HTTPS_PROXY) as a fallback.
 *
 * Usage: import { proxyFetch } from '../utils/proxy-fetch';
 *        const res = await proxyFetch('https://api.example.com', { ... });
 */

import { SettingsManager } from '../settings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ProxyAgentCtor: (new (url: string) => any) | null = null;
let undiciLoaded = false;

async function loadUndici(): Promise<void> {
  if (undiciLoaded) return;
  try {
    // Node 22 bundles undici but doesn't expose types — use dynamic import
    // via Function constructor to bypass TypeScript module resolution
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;
    const undici = await dynamicImport('undici');
    ProxyAgentCtor = undici.ProxyAgent;
  } catch {
    console.warn('[proxy-fetch] undici not available, proxy support disabled');
  }
  undiciLoaded = true;
}

/**
 * Resolve the proxy URL from settings or environment variables.
 * Returns null if no proxy is configured.
 */
export function getProxyUrl(): string | null {
  const settingsUrl = SettingsManager.get('proxy.url');
  if (settingsUrl) return settingsUrl;

  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    null
  );
}

/**
 * Proxy-aware fetch. Identical signature to global fetch().
 * Routes through proxy when configured; falls back to direct fetch otherwise.
 */
export async function proxyFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const proxyUrl = getProxyUrl();

  if (!proxyUrl) {
    return fetch(input, init);
  }

  await loadUndici();

  if (!ProxyAgentCtor) {
    return fetch(input, init);
  }

  const agent = new ProxyAgentCtor(proxyUrl);
  // Node's global fetch accepts undici dispatcher via extended options
  return fetch(input, {
    ...init,
    dispatcher: agent,
  } as RequestInit & { dispatcher: unknown });
}
