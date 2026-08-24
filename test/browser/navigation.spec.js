import { test, expect } from '@playwright/test';

const sampleMovie = {
  id: 27205,
  title: 'Inception',
  original_title: 'Inception',
  media_type: 'movie',
  overview: 'A deterministic browser-test fixture.',
  release_date: '2010-07-16',
  backdrop_path: '/backdrop.jpg',
  poster_path: '/poster.jpg',
  vote_average: 8.4,
  vote_count: 1000,
  runtime: 148,
  genre_ids: [28],
  genres: [{ id: 28, name: 'Action' }],
  similar: { results: [] },
};

const sampleTv = {
  id: 125988,
  name: 'Silo',
  original_name: 'Silo',
  media_type: 'tv',
  overview: 'A deterministic series fixture.',
  first_air_date: '2023-05-05',
  backdrop_path: '/silo-backdrop.jpg',
  poster_path: '/silo-poster.jpg',
  vote_average: 8.1,
  vote_count: 900,
  episode_run_time: [50],
  genre_ids: [18],
  genres: [{ id: 18, name: 'Drama' }],
  seasons: [{ season_number: 1, episode_count: 1 }],
  similar: { results: [] },
};

const sampleAnime = {
  id: 30984,
  name: 'BLEACH',
  original_name: 'Bleach',
  media_type: 'tv',
  overview: 'Anime player regression fixture.',
  first_air_date: '2004-10-05',
  backdrop_path: '/bleach-backdrop.jpg',
  poster_path: '/bleach-poster.jpg',
  vote_average: 8.4,
  vote_count: 2200,
  episode_run_time: [24],
  genre_ids: [16],
  genres: [{ id: 16, name: 'Animation' }],
  seasons: [{ season_number: 1, episode_count: 1 }],
  similar: { results: [] },
};

async function mockApplicationApi(page, { geMovieAvailable = true, animebAvailable = false } = {}) {
  await page.route('**/api/ge-movie/status**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, available: geMovieAvailable, provider: 'ge.movie' }),
  }));
  await page.route('**/api/providers/status**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, providers: [{ id: 'ge.movie', label: 'ge.movie', healthy: true }] }),
  }));
  await page.route('**/imovs?**', route => {
    const source = new URL(route.request().url()).searchParams.get('source');
    const playableSource = source === 'imovs.ge' || source === 'kinolab.cc';
    const blockedSource = source === 'geofilms.net';
    const players = playableSource || blockedSource ? [{
      source,
      streams: [{
        label: source,
        file: blockedSource ? 'https://vsembed.ru/embed/movie/tt1375666' : 'https://myfilm.example/play?u=https%3A%2F%2Fimovs.ge%2Fembed%2Finception&ref=https%3A%2F%2Fimovs.ge',
        rawUrl: blockedSource ? 'https://vsembed.ru/embed/movie/tt1375666' : 'https://imovs.ge/embed/inception',
        isIframe: true,
      }],
    }] : [];
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: players.length > 0, players }),
    });
  });
  await page.route('**/imovs-series?**', route => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source');
    const isSelectedEpisode = url.searchParams.get('season') === '1' && url.searchParams.get('episode') === '1';
    const available = source === 'adjaranetto.com' || source === 'imovs.ge' || (source === 'Croconet.cam' && isSelectedEpisode);
    const resultCount = source === 'imovs.ge' ? 2 : available ? 1 : 0;
    const episodes = Array.from({ length: resultCount }, (_unused, index) => ({
      season: 1,
      episode: 1,
      streams: [{
        label: source,
        source,
        file: `https://myfilm.example/play?u=${encodeURIComponent(`https://${source}/embed/silo-s1e1-${index}`)}`,
        rawUrl: `https://${source}/embed/silo-s1e1-${index}`,
        isIframe: true,
      }],
    }));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: episodes.length > 0, episodes }),
    });
  });
  await page.route('**/animeb?**', route => {
    const requestUrl = new URL(route.request().url());
    const available = animebAvailable && requestUrl.searchParams.get('year') === '2004';
    const rawUrl = 'https://video.sibnet.ru/shell.php?videoid=5704899';
    const file = `https://myfilm.example/play?u=${encodeURIComponent(rawUrl)}&ref=${encodeURIComponent('https://animeb.ge/anime/365-bleach.html')}`;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: available,
        episodes: available ? [{ season: 1, episode: 1, source: 'animeb.ge', streams: [{ file, rawUrl, isIframe: true }] }] : [],
      }),
    });
  });
  await page.route('**/animetv?**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, episodes: [] }),
  }));
  await page.route('**/api/tmdb/**', route => {
    const url = new URL(route.request().url());
    let body;
    if (/\/genre\/(?:movie|tv)\/list$/.test(url.pathname)) body = { genres: [{ id: 28, name: 'Action' }] };
    else if (/\/movie\/27205$/.test(url.pathname)) body = sampleMovie;
    else if (/\/tv\/125988$/.test(url.pathname)) body = sampleTv;
    else if (/\/tv\/30984$/.test(url.pathname)) body = sampleAnime;
    else body = { page: 1, results: [sampleMovie], total_pages: 1, total_results: 1 };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('clean navigation and legacy hash migration work', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.nav-brand')).toBeVisible();
  if (await page.locator('#nav-burger').isVisible()) await page.locator('#nav-burger').click();
  await page.locator('#nav-search').click();
  await expect(page).toHaveURL(/\/search$/);
  await page.goto('/#/movies');
  await expect(page).toHaveURL(/\/movies$/);
});

test('APK dialog opens and remains keyboard accessible', async ({ page }) => {
  await page.goto('/');
  await page.locator('#app-download-open').click();
  await expect(page.locator('#app-download-dialog')).toBeVisible();
  await expect(page.locator('.dialog-download')).toHaveAttribute('href', /MyFilm\.apk$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app-download-dialog')).not.toBeVisible();
});

test('a direct clean detail URL loads SPA assets from the site root', async ({ page }) => {
  await mockApplicationApi(page);
  await page.goto('/movie/27205');
  await expect(page.locator('.nav-brand')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof Router)).toBe('object');
  await expect.poll(() => page.evaluate(() => typeof DetailView)).toBe('object');
  await expect(page.locator('.detail-title')).toHaveText('Inception');
  const playerFrame = page.locator('.iframe-player-wrap iframe');
  await expect(playerFrame).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(page.locator('#quality-select option')).toHaveText(['ge.movie', 'imovs.ge']);
  await expect(page.locator('#quality-select')).toHaveValue('0');
});

test('ge.movie is hidden when its catalog reports the title as unavailable', async ({ page }) => {
  await mockApplicationApi(page, { geMovieAvailable: false });
  await page.goto('/movie/27205');
  await expect(page.locator('.detail-title')).toHaveText('Inception');
  await expect(page.locator('.iframe-player-wrap iframe[src*="em.filmx.my"]')).toHaveCount(0);
  await expect(page.locator('#quality-select option', { hasText: 'ge.movie' })).toHaveCount(0);
});

test('a selected series episode adds only providers that return that episode', async ({ page }) => {
  await mockApplicationApi(page);
  await page.goto('/tv/125988');
  await expect(page.locator('.detail-title')).toHaveText('Silo');
  await expect(page.locator('#quality-select option')).toHaveText(['ge.movie', 'adjaranetto.com', 'imovs.ge', 'Croconet.cam']);
  await expect(page.locator('#quality-select')).toHaveValue('0');
});

test('AnimeB uses the episode embed and never opens its catalog page inside the player', async ({ page }) => {
  const documentRequests = [];
  page.on('request', request => {
    if (request.resourceType() === 'document') documentRequests.push(request.url());
  });
  await mockApplicationApi(page, { geMovieAvailable: false, animebAvailable: true });
  await page.goto('/tv/30984');
  await expect(page.locator('.detail-title')).toHaveText('BLEACH');
  await expect(page.locator('#quality-select option', { hasText: 'animeb.ge' })).toHaveCount(1);
  await page.locator('#quality-select').selectOption({ label: 'animeb.ge' });
  await expect.poll(() => documentRequests.some(url => /video\.sibnet\.ru\/shell\.php/.test(url))).toBe(true);
  expect(documentRequests.some(url => /animeb\.ge\/anime\//.test(url))).toBe(false);
});

test('cards expose keyboard link semantics when content is rendered', async ({ page }) => {
  await mockApplicationApi(page);
  await page.goto('/');
  const card = page.locator('.movie-card').first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('role', 'link');
  await expect(card).toHaveAttribute('tabindex', '0');
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/movie\/27205$/);
});

test('search query renders results without a stale async response', async ({ page }) => {
  await mockApplicationApi(page);
  await page.goto('/search/Inception');
  await expect(page.locator('#search-input')).toHaveValue('Inception');
  await expect(page.locator('.movie-card').first()).toBeVisible();
  await expect(page.locator('#search-info')).toContainText('Inception');
});
