import { isPlayableCandidate } from './common.js';

export function extractAnimeReleaseYear(html) {
  const source = String(html || '');
  const infoYear = source.match(/rating-score-mobile[^>]*>[\s\S]{0,240}?\/xfsearch\/year\/((?:19|20)\d{2})/i);
  return infoYear ? Number(infoYear[1]) : null;
}

export function animeTitleFromUrl(value) {
  try {
    return decodeURIComponent(new URL(value).pathname.split('/').filter(Boolean).pop() || '')
      .replace(/\.html$/i, '')
      .replace(/^\d+-/, '')
      .replace(/[-_]+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

export function isAnimeEpisodePlayerUrl(value) {
  if (!isPlayableCandidate(value)) return false;
  try {
    const parsed = new URL(value);
    return !/(^|\.)(?:animeb|animetv)\.ge$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}
