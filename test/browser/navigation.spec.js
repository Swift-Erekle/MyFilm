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

async function mockApplicationApi(page) {
  await page.route('**/api/providers/status**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, providers: [{ id: 'ge.movie', label: 'ge.movie', healthy: true }] }),
  }));
  await page.route('**/imovs?**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      players: [{
        source: 'imovs.ge',
        streams: [{
          label: 'imovs.ge',
          file: 'https://myfilm.example/play?u=https%3A%2F%2Fimovs.ge%2Fembed%2Finception&ref=https%3A%2F%2Fimovs.ge',
          rawUrl: 'https://imovs.ge/embed/inception',
          isIframe: true,
        }],
      }],
    }),
  }));
  await page.route('**/api/tmdb/**', route => {
    const url = new URL(route.request().url());
    let body;
    if (/\/genre\/(?:movie|tv)\/list$/.test(url.pathname)) body = { genres: [{ id: 28, name: 'Action' }] };
    else if (/\/movie\/27205$/.test(url.pathname)) body = sampleMovie;
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
