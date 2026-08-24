import test from 'node:test';
import assert from 'node:assert/strict';
import { animeTitleFromUrl, extractAnimeReleaseYear, isAnimeEpisodePlayerUrl } from '../src/providers/index.js';

test('AnimeB release year is read from the selected title info instead of the year sidebar', () => {
  const fixture = `
    <aside><a href="/xfsearch/year/2025">2025</a><a href="/xfsearch/year/2004">2004</a></aside>
    <p class="rating-score-mobile">Year <a href="https://animeb.ge/xfsearch/year/2022/">2022</a></p>
  `;
  assert.equal(extractAnimeReleaseYear(fixture), 2022);
});

test('anime episode candidates reject catalog pages and accept real embeds', () => {
  assert.equal(isAnimeEpisodePlayerUrl('https://animeb.ge/anime/365-bleach.html'), false);
  assert.equal(isAnimeEpisodePlayerUrl('https://video.sibnet.ru/shell.php?videoid=5704899'), true);
});

test('anime candidate scoring can distinguish a base title from sequel slugs', () => {
  assert.equal(animeTitleFromUrl('https://animeb.ge/anime/77-jujutsu-kaisen.html'), 'jujutsu kaisen');
  assert.equal(animeTitleFromUrl('https://animeb.ge/anime/463-jujutsu-kaisen-3rd-season.html'), 'jujutsu kaisen 3rd season');
});
