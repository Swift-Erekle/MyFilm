import {
  absoluteUrl,
  bestTitleCandidate,
  extractPlayerUrls,
  fetchHtml,
  normalizeTitle,
} from './common.js';

function detailCandidates(html, provider) {
  const candidates = [];
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const url = absoluteUrl(match[1], provider.baseUrl);
    if (!url) continue;
    const parsed = new URL(url);
    const wantedHost = new URL(provider.baseUrl).hostname.replace(/^www\./, '');
    if (parsed.hostname.replace(/^www\./, '') !== wantedHost) continue;
    if (/\/(?:category|genre|tag|page|actor|director|year|search|wp-content)\//i.test(parsed.pathname)) continue;
    if (parsed.pathname === '/' || parsed.pathname.length < 4) continue;
    const anchorText = match[2].replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ');
    let slug = parsed.pathname.split('/').filter(Boolean).pop() || '';
    try { slug = decodeURIComponent(slug); } catch { /* keep the encoded slug */ }
    slug = slug.replace(/^\d+-/, '').replace(/[-_]/g, ' ');
    candidates.push({ url, title: `${anchorText} ${slug}`.trim() });
  }
  return [...new Map(candidates.map(candidate => [candidate.url, candidate])).values()];
}

export async function searchGenericProvider(provider, context) {
  const queries = [...new Set([context.query, context.engQuery, context.geoQuery].filter(Boolean))];
  const candidates = [];

  for (const query of queries) {
    const form = new URLSearchParams({ do: 'search', subaction: 'search', story: query });
    const target = provider.searchMethod === 'POST'
      ? provider.searchUrl
      : `${provider.searchUrl}${provider.searchUrl.includes('?') ? '&' : '?'}s=${encodeURIComponent(query)}`;
    const { text } = await fetchHtml(target, {
      referer: provider.baseUrl,
      method: provider.searchMethod,
      body: provider.searchMethod === 'POST' ? form : undefined,
      timeoutMs: 9_000,
    });
    candidates.push(...detailCandidates(text, provider));
    if (candidates.length) break;
  }

  const best = bestTitleCandidate(candidates, queries, 0.25);
  if (!best) return [];
  const { text, finalUrl } = await fetchHtml(best.url, { referer: provider.baseUrl, timeoutMs: 10_000 });
  const pageTitle = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || best.title;
  if (Math.max(...queries.map(query => normalizeTitle(pageTitle).includes(normalizeTitle(query)) ? 1 : 0)) === 0 && best.score < 0.45) return [];

  return extractPlayerUrls(text, finalUrl).map((url, index) => ({
    file: url,
    rawUrl: url,
    label: `${provider.label} ${index + 1}`,
    source: provider.id,
    isIframe: !/\.(?:m3u8|mp4)(?:\?|$)/i.test(url),
  }));
}
