import { fetchWithTimeout, htmlHeaders, titleScore } from './common.js';

const SEARCH_TIMEOUT_MS = 5_500;

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x27|39);/gi, "'")
    .replace(/&#(?:x3d|61);/gi, '=')
    .replace(/&#(?:x2f|47);/gi, '/');
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalHost(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '');
}

function unwrapResultUrl(rawValue, searchBase) {
  const raw = decodeEntities(rawValue).trim();
  if (!raw || /^(?:javascript|mailto|tel):/i.test(raw)) return '';

  try {
    const parsed = new URL(raw, searchBase);
    if (/google\./i.test(parsed.hostname) && parsed.pathname === '/url') {
      return parsed.searchParams.get('q') || parsed.searchParams.get('url') || '';
    }
    if (/duckduckgo\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith('/l/')) {
      return parsed.searchParams.get('uddg') || '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function isProviderDetailUrl(value, providerBaseUrl) {
  try {
    const candidate = new URL(value);
    const provider = new URL(providerBaseUrl);
    if (candidate.protocol !== 'https:') return false;
    if (canonicalHost(candidate.hostname) !== canonicalHost(provider.hostname)) return false;
    if (candidate.pathname === '/' || candidate.pathname.length < 4) return false;
    return !/(?:^|\/)(?:search|category|categories|genre|genres|tag|tags|page|actor|actors|director|directors|year|years|country|countries|news|wp-content|assets?|static)(?:\/|$)/i.test(candidate.pathname)
      && !/\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|xml|txt)(?:$|\?)/i.test(candidate.pathname);
  } catch {
    return false;
  }
}

export function extractSearchResultCandidates(html, searchUrl, provider) {
  const candidates = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  let match;
  while ((match = anchorPattern.exec(String(html || ''))) !== null) {
    const url = unwrapResultUrl(match[1], searchUrl);
    if (!isProviderDetailUrl(url, provider.baseUrl)) continue;
    let slug = '';
    try {
      slug = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '')
        .replace(/^\d+-/, '')
        .replace(/\.html$/i, '')
        .replace(/[-_]+/g, ' ');
    } catch { /* keep title from the result anchor */ }
    const title = `${stripTags(match[2])} ${slug}`.trim();
    candidates.push({ url, title, discovery: new URL(searchUrl).hostname });
  }
  const rssPattern = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/giu;
  while ((match = rssPattern.exec(String(html || ''))) !== null) {
    const url = unwrapResultUrl(stripTags(match[2]), searchUrl);
    if (!isProviderDetailUrl(url, provider.baseUrl)) continue;
    candidates.push({ url, title: stripTags(match[1]), discovery: new URL(searchUrl).hostname });
  }
  return [...new Map(candidates.map(candidate => [candidate.url, candidate])).values()];
}

function googleBlocked(html) {
  const sample = String(html || '').slice(0, 120_000);
  return /emsg=SG_REL|our systems have detected unusual traffic|\/sorry\/index|recaptcha/i.test(sample);
}

async function fetchResults(searchUrl, provider) {
  const response = await fetchWithTimeout(searchUrl, {
    headers: htmlHeaders(`${new URL(searchUrl).origin}/`),
    redirect: 'follow',
  }, { timeoutMs: SEARCH_TIMEOUT_MS, retry: false });
  if (!response.ok) return [];
  const html = await response.text();
  if (googleBlocked(html)) return [];
  return extractSearchResultCandidates(html, searchUrl, provider);
}

/**
 * Second-stage discovery only. The caller must still fetch the provider page,
 * validate its title/year and confirm that it contains a playable stream.
 */
export async function searchWebForProvider(provider, context = {}) {
  const queries = [...new Set([
    context.engQuery,
    context.query,
    context.geoQuery,
  ].map(value => String(value || '').trim()).filter(Boolean))];
  if (!queries.length) return [];

  const providerHost = canonicalHost(new URL(provider.baseUrl).hostname);
  const title = queries[0];
  const year = Number(context.year) || '';
  const scopedQuery = [`site:${providerHost}`, `"${title}"`, year].filter(Boolean).join(' ');
  const engines = [
    `https://www.google.com/search?hl=en&num=8&filter=0&q=${encodeURIComponent(scopedQuery)}`,
    `https://search.brave.com/search?source=web&q=${encodeURIComponent(scopedQuery)}`,
    `https://www.bing.com/search?format=rss&q=${encodeURIComponent(scopedQuery)}`,
  ];

  for (const engineUrl of engines) {
    try {
      const candidates = await fetchResults(engineUrl, provider);
      const ranked = candidates
        .map(candidate => ({
          ...candidate,
          score: Math.max(...queries.map(query => titleScore(query, candidate.title || candidate.url))),
        }))
        .filter(candidate => candidate.score >= 0.25)
        .sort((a, b) => b.score - a.score);
      if (ranked.length) return ranked.slice(0, 8);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'provider_web_search_failed',
        provider: provider.id || providerHost,
        engine: new URL(engineUrl).hostname,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return [];
}
