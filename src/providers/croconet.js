import { titleScore } from './common.js';

function cleanHlsUrl(value) {
  return String(value || '')
    .replace(/\\+/g, '/')
    .replace(/\/+/g, '/')
    .replace(':/', '://');
}

function isTrailer(value) {
  return /\/(?:treiler|trailer)\//i.test(value);
}

/**
 * Croconet serializes the selected title first and then appends full media
 * objects for recommendations. The first trailer is the boundary between the
 * selected title's streams and those unrelated recommendation objects.
 */
export function extractCroconetPrimaryHls(html) {
  const matches = [...String(html || '').matchAll(/https?:[^\s"'`,]+?\.m3u8/giu)]
    .map(match => ({ index: match.index, url: cleanHlsUrl(match[0]) }));
  if (!matches.length || isTrailer(matches[0].url)) return [];

  const trailerBoundary = matches.find(match => match.index > matches[0].index && isTrailer(match.url));
  let primary = trailerBoundary
    ? matches.filter(match => match.index < trailerBoundary.index && !isTrailer(match.url))
    : [];

  // Some entries have no trailer. In that case keep only the first tightly
  // grouped media object instead of drifting into recommendation payloads.
  if (!trailerBoundary) {
    primary = [matches[0]];
    for (let index = 1; index < matches.length; index += 1) {
      if (matches[index].index - matches[index - 1].index > 2_500 || isTrailer(matches[index].url)) break;
      primary.push(matches[index]);
    }
  }

  return [...new Set(primary.map(match => match.url))];
}

export function croconetMediaIdentity(value) {
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    const ignored = /^(?:index|master|playlist|manifest|sd|hd|fhd|fullhd|\d{3,4}p|\d{1,2}[_-]\d{1,3})$/i;
    let rawTitle = '';
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index].replace(/\.m3u8$/i, '');
      if (!part || ignored.test(part) || /^(?:movies?|serial|series)$/i.test(part)) continue;
      rawTitle = part;
      break;
    }
    const yearMatch = rawTitle.match(/((?:19|20)\d{2})/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const title = rawTitle
      .replace(/[_-]+/g, ' ')
      .replace(/(?:19|20)\d{2}/g, ' ')
      .replace(/\b(?:geo|eng|rus|qartulad|inglisurad|sd|hd|fhd|fullhd|extended|dubbed)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { title, year };
  } catch {
    return { title: '', year: null };
  }
}

export function chooseCroconetMovieHls(urls, queries, wantedYear) {
  const ranked = [];
  for (const url of urls || []) {
    const identity = croconetMediaIdentity(url);
    if (!identity.title) continue;
    if (wantedYear && identity.year !== Number(wantedYear)) continue;
    const score = Math.max(...queries.filter(Boolean).map(query => titleScore(query, identity.title)));
    if (score < 0.45) continue;
    ranked.push({ url, score, yearMatched: wantedYear && identity.year === Number(wantedYear) ? 1 : 0 });
  }
  ranked.sort((a, b) => b.yearMatched - a.yearMatched || b.score - a.score);
  return ranked[0]?.url || '';
}
