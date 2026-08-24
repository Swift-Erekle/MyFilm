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

function extractYear(value) {
  const match = String(value || '').match(/\b((?:19|20)\d{2})\b/);
  return match ? Number(match[1]) : null;
}

export async function searchGenericProvider(provider, context) {
  const queries = [...new Set([context.query, context.engQuery, context.geoQuery].filter(Boolean))];
  const wantedYear = Number(context.year) || null;
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
  }

  const remaining = [...new Map(candidates.map(candidate => [candidate.url, candidate])).values()]
    .filter(candidate => !wantedYear || !extractYear(candidate.title) || extractYear(candidate.title) === wantedYear);

  for (let attempt = 0; attempt < 8 && remaining.length; attempt += 1) {
    const best = bestTitleCandidate(remaining, queries, 0.25);
    if (!best) break;
    const candidateIndex = remaining.findIndex(candidate => candidate.url === best.url);
    if (candidateIndex !== -1) remaining.splice(candidateIndex, 1);

    try {
      const { text, finalUrl } = await fetchHtml(best.url, { referer: provider.baseUrl, timeoutMs: 10_000 });
      const pageTitle = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || best.title;
      const pageYear = extractYear(pageTitle);
      if (wantedYear && pageYear && pageYear !== wantedYear) continue;
      if (Math.max(...queries.map(query => normalizeTitle(pageTitle).includes(normalizeTitle(query)) ? 1 : 0)) === 0 && best.score < 0.45) continue;

      const playerUrls = extractPlayerUrls(text, finalUrl);
      if (!playerUrls.length) continue;
      return playerUrls.map((url, index) => ({
        file: url,
        rawUrl: url,
        label: `${provider.label} ${index + 1}`,
        source: provider.id,
        isIframe: !/\.(?:m3u8|mp4)(?:\?|$)/i.test(url),
      }));
    } catch { /* try the next matching detail candidate */ }
  }

  return [];
}
