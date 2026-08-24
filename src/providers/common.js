const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

export const DEFAULT_TIMEOUT_MS = 10_000;

export function htmlHeaders(referer = '') {
  const headers = new Headers({
    'User-Agent': DESKTOP_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ka,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'identity',
    'Cache-Control': 'no-cache',
  });
  if (referer) {
    headers.set('Referer', referer);
    try { headers.set('Origin', new URL(referer).origin); } catch { /* invalid optional referer */ }
  }
  return headers;
}

export function isChallengePage(text, status = 200) {
  if (status === 403 || status === 429 || status === 503) return true;
  const sample = String(text || '').slice(0, 30_000);
  return /<title>\s*(?:Just a moment|Attention Required|Access denied)\b/i.test(sample)
    || /cf-chl-(?:opt|widget|bypass)|challenge-platform\/h\/g\/orchestrate|cloudflare ray id/i.test(sample);
}

export async function fetchWithTimeout(target, options = {}, config = {}) {
  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  const attempts = config.retry === false ? 1 : 2;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), timeoutMs);
    try {
      const response = await fetch(target, { redirect: 'follow', ...options, signal: controller.signal });
      if (response.ok || ![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts - 1) {
        return response;
      }
      lastError = new Error(`provider_http_${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('provider_fetch_failed');
}

export async function fetchHtml(target, { referer = '', method = 'GET', body, timeoutMs } = {}) {
  const response = await fetchWithTimeout(target, {
    method,
    body,
    headers: htmlHeaders(referer),
  }, { timeoutMs });
  const text = await response.text();
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  if (isChallengePage(text, response.status)) throw new Error('provider_challenge');
  return { text, response, finalUrl: response.url || target };
}

export function absoluteUrl(value, base) {
  try {
    const url = new URL(String(value || '').replace(/&amp;/g, '&'), base);
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ka-GE')
    .replace(/\b(?:season|სეზონი|сезон)\s*\d+\b/giu, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9\u10D0-\u10FF]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleScore(query, candidate) {
  const wanted = normalizeTitle(query);
  const found = normalizeTitle(candidate);
  if (!wanted || !found) return 0;
  if (wanted === found) return 2;
  if (found.includes(wanted) || wanted.includes(found)) return 1.35;
  const wantedTokens = new Set(wanted.split(' '));
  const foundTokens = new Set(found.split(' '));
  let hits = 0;
  for (const token of wantedTokens) if (foundTokens.has(token)) hits += 1;
  return hits / Math.max(wantedTokens.size, foundTokens.size);
}

export function bestTitleCandidate(candidates, queries, minimum = 0.35) {
  let best = null;
  for (const candidate of candidates) {
    const candidateText = `${candidate.title || ''} ${candidate.url || ''}`;
    if (/(?:youtube\.com|youtu\.be|\btrailer\b|\btreiler\b|\bტრეილერი\b|(?:^|[\s/_.-])ads?(?:[\s/_.-]|$)|banner)/iu.test(candidateText)) continue;
    const score = Math.max(...queries.filter(Boolean).map(query => titleScore(query, candidate.title || candidate.url)));
    if (!best || score > best.score) best = { ...candidate, score };
  }
  return best && best.score >= minimum ? best : null;
}

export function isPlayableCandidate(value) {
  const raw = String(value || '').trim();
  if (!raw || /(?:youtube\.com|youtu\.be|vidsrc|vsembed|streamingnow\.mov|trailer|treiler|google-analytics|googletagmanager|doubleclick|facebook\.com\/plugins|(?:^|[./_-])ads?(?:[./_-]|$)|banner|\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|woff2?|ttf)(?:\?|$))/i.test(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && /(?:embed|player|video|stream|\.m3u8|\.mp4|sibnet|mail\.ru|ok\.ru|vkvideo|myvi|stormo|secvideo|csst|incvideo|fmovie|mykadri|allarknow|drive\.google)/i.test(url.toString());
  } catch {
    return false;
  }
}

export function extractPlayerUrls(html, baseUrl) {
  const out = new Set();
  // Limit ordinary src attributes to media/embed tags. A broad href/src scan
  // mistakes stylesheet and player-library assets for playable embeds.
  const attributes = /<(?:iframe|video|source)\b[^>]*?(?:src|data-src)=["']([^"']+)["'][^>]*>|\b(?:data-url|data-video|data-player|data-load-link|data-load-embed)=["']([^"']+)["']/giu;
  let match;
  while ((match = attributes.exec(html)) !== null) {
    const value = match[1] || match[2];
    const url = absoluteUrl(value.replace(/\\\//g, '/'), baseUrl);
    if (isPlayableCandidate(url)) out.add(url);
  }
  // Several DLE themes pass an iframe URL to their player module as
  // `movie: "https://…/embed/…"` instead of rendering an iframe in HTML.
  const playerProperties = /\b(?:movie|file|player|embed)\s*:\s*["'](https?:\\?\/\\?\/[^"']+)["']/giu;
  while ((match = playerProperties.exec(html)) !== null) {
    const url = match[1].replace(/\\\//g, '/');
    if (isPlayableCandidate(url)) out.add(url);
  }
  const direct = /https?:\\?\/\\?\/[^"'\s<>`]+(?:\.m3u8|\.mp4)(?:\?[^"'\s<>`]*)?/giu;
  while ((match = direct.exec(html)) !== null) {
    const url = match[0].replace(/\\/g, '');
    if (isPlayableCandidate(url)) out.add(url);
  }
  return [...out];
}

export function extractAssignedObject(source, variableName) {
  const assignment = new RegExp(`(?:const|let|var)?\\s*${variableName}\\s*=\\s*\\{`, 'g');
  let match;
  let last = '';
  while ((match = assignment.exec(source)) !== null) {
    const start = source.indexOf('{', match.index);
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) { last = source.slice(start, index + 1); break; }
    }
  }
  return last;
}

export function parsePlayerArrays(objectSource) {
  const players = [];
  const arrayPattern = /([A-Za-z_$][\w$]*)\s*:\s*\[([\s\S]*?)\]\s*,?/g;
  let match;
  while ((match = arrayPattern.exec(objectSource || '')) !== null) {
    const urls = [];
    const valuePattern = /["'](https?:\/\/[^"']+)["']/g;
    let value;
    while ((value = valuePattern.exec(match[2])) !== null) {
      const url = value[1].replace(/\\\//g, '/');
      if (isPlayableCandidate(url)) urls.push(url);
    }
    if (urls.length) players.push({ id: match[1], urls });
  }
  return players;
}

export function safeErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error || 'provider_failed');
  if (/timeout|abort/i.test(message)) return 'PROVIDER_TIMEOUT';
  if (/challenge|403|429/i.test(message)) return 'PROVIDER_BLOCKED';
  if (/not[_ ]?found/i.test(message)) return 'NOT_FOUND';
  return 'PROVIDER_FAILED';
}
