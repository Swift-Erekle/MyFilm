import { test, expect } from '@playwright/test';

const sampleMovie = {
  id: 27205,
  title: 'Inception',
  original_title: 'Inception',
  media_type: 'movie',
  overview: 'TV lifecycle movie fixture.',
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
  overview: 'TV lifecycle series fixture.',
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

async function installNativeBridgeAndFullscreenMock(page) {
  await page.addInitScript(() => {
    window.__myfilmNativeMessages = [];
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: {
        postMessage(value) {
          try {
            window.__myfilmNativeMessages.push(JSON.parse(value));
          } catch {
            window.__myfilmNativeMessages.push(value);
          }
        },
      },
    });

    let fullscreenTarget = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenTarget,
    });
    Object.defineProperty(document, 'webkitFullscreenElement', {
      configurable: true,
      get: () => fullscreenTarget,
    });
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value() {
        fullscreenTarget = this;
        document.dispatchEvent(new Event('fullscreenchange'));
        return Promise.resolve();
      },
    });
    Object.defineProperty(Element.prototype, 'webkitRequestFullscreen', {
      configurable: true,
      value() {
        fullscreenTarget = this;
        document.dispatchEvent(new Event('webkitfullscreenchange'));
      },
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value() {
        fullscreenTarget = null;
        document.dispatchEvent(new Event('fullscreenchange'));
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, 'webkitExitFullscreen', {
      configurable: true,
      value() {
        fullscreenTarget = null;
        document.dispatchEvent(new Event('webkitfullscreenchange'));
      },
    });
  });
}

async function mockLifecycleApi(page, { seriesProvidersAvailable = true } = {}) {
  const providerDocument = route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body><video controls></video></body></html>',
  });
  await page.route('https://em.filmx.my/**', providerDocument);
  await page.route('https://imovs.ge/**', providerDocument);
  await page.route('https://adjaranetto.com/**', providerDocument);
  await page.route('https://croconet.cam/**', providerDocument);

  await page.route('**/api/ge-movie/status**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, available: true, provider: 'ge.movie' }),
  }));
  await page.route('**/api/providers/status**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      providers: [
        { id: 'ge.movie', healthy: true },
        { id: 'imovs.ge', healthy: true },
        { id: 'adjaranetto.com', healthy: true },
        { id: 'Croconet.cam', healthy: true },
      ],
    }),
  }));
  await page.route('**/imovs?**', route => {
    const source = new URL(route.request().url()).searchParams.get('source');
    const available = source === 'imovs.ge';
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: available,
        players: available ? [{
          source,
          streams: [{
            label: source,
            source,
            file: `https://myfilm.example/play?u=${encodeURIComponent('https://imovs.ge/embed/inception')}`,
            rawUrl: 'https://imovs.ge/embed/inception',
            isIframe: true,
          }],
        }] : [],
      }),
    });
  });
  await page.route('**/imovs-series?**', route => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source');
    const available = seriesProvidersAvailable && ['adjaranetto.com', 'imovs.ge', 'Croconet.cam'].includes(source);
    const rawUrl = source === 'Croconet.cam'
      ? 'https://croconet.cam/embed/silo-s1e1'
      : `https://${source}/embed/silo-s1e1`;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: available,
        episodes: available ? [{
          season: 1,
          episode: 1,
          streams: [{
            label: source,
            source,
            file: `https://myfilm.example/play?u=${encodeURIComponent(rawUrl)}`,
            rawUrl,
            isIframe: true,
          }],
        }] : [],
      }),
    });
  });
  await page.route('**/animeb?**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, episodes: [] }),
  }));
  await page.route('**/animetv?**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, episodes: [] }),
  }));
  await page.route('**/api/tmdb/**', route => {
    const url = new URL(route.request().url());
    let body;
    if (/\/movie\/27205$/.test(url.pathname)) body = sampleMovie;
    else if (/\/tv\/125988$/.test(url.pathname)) body = sampleTv;
    else if (/\/genre\/(?:movie|tv)\/list$/.test(url.pathname)) body = { genres: [{ id: 28, name: 'Action' }] };
    else body = { page: 1, results: [sampleMovie], total_pages: 1, total_results: 1 };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('mobile navigation opens, closes, and restores page scrolling', async ({ page }, testInfo) => {
  test.skip(!['mobile', 'iphone'].includes(testInfo.project.name), 'Mobile-menu lifecycle only');
  await mockLifecycleApi(page);
  await page.goto('/');

  const burger = page.locator('#nav-burger');
  await expect(burger).toBeVisible();
  await burger.click();
  await expect(burger).toHaveClass(/open/);
  await expect(page.locator('.nav-links')).toHaveClass(/nav-open/);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');

  await burger.click();
  await expect(burger).not.toHaveClass(/open/);
  await expect(page.locator('.nav-links')).not.toHaveClass(/nav-open/);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('movie player switches source and is destroyed when leaving the detail route', async ({ page }) => {
  await mockLifecycleApi(page);
  await page.goto('/');
  await page.evaluate(() => Router.go('/movie/27205'));

  await expect(page.locator('.detail-title')).toHaveText('Inception');
  await expect(page.locator('#quality-select option')).toHaveText(['ge.movie', 'imovs.ge']);
  await expect(page.locator('.iframe-badge')).toContainText('ge.movie');
  await expect(page.locator('.iframe-player-wrap iframe')).toHaveCount(1);

  await page.locator('#quality-select').selectOption({ label: 'imovs.ge' });
  await expect(page.locator('.iframe-badge')).toContainText('imovs.ge');
  await expect(page.locator('.iframe-player-wrap iframe')).toHaveCount(1);

  await page.evaluate(() => Router.go('/'));
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#view-home')).toHaveClass(/view--active/);
  await expect(page.locator('#player-container iframe')).toHaveCount(0);
  await expect(page.locator('#player-container')).toBeEmpty();
});

test('TV Back closes the series menu first, then leaves detail and destroys the player', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tv', 'TV-only Back lifecycle');
  await installNativeBridgeAndFullscreenMock(page);
  await mockLifecycleApi(page);
  await page.goto('/');
  await page.evaluate(() => Router.go('/tv/125988'));

  await expect(page.locator('.detail-title')).toHaveText('Silo');
  await expect(page.locator('.iframe-player-wrap iframe')).toHaveCount(1);

  await page.locator('#burger-trigger').click();
  await expect(page.locator('#burger-panel')).toHaveClass(/open/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#burger-panel')).not.toHaveClass(/open/);
  await expect(page).toHaveURL(/\/tv\/125988$/);
  await expect(page.locator('.iframe-player-wrap iframe')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#player-container iframe')).toHaveCount(0);
  await expect(page.locator('#player-container')).toBeEmpty();

  const backMessages = await page.evaluate(() =>
    window.__myfilmNativeMessages.filter(message => message?.type === 'MYFILM_BACK_RESULT'));
  expect(backMessages.some(message => message.handled === true)).toBe(true);
});

test('TV fullscreen opens on the player and Back exits fullscreen without leaving the movie', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tv', 'TV-only fullscreen lifecycle');
  await installNativeBridgeAndFullscreenMock(page);
  await mockLifecycleApi(page);
  await page.goto('/');
  await page.evaluate(() => Router.go('/movie/27205'));

  await expect(page.locator('.detail-title')).toHaveText('Inception');
  const fullscreenHit = page.locator('.player-fullscreen-hit--iframe');
  await expect(fullscreenHit).toHaveCount(1);
  await fullscreenHit.click({ force: true });

  await expect.poll(() => page.evaluate(() => MyFilmPlatform.isFullscreen())).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    window.__myfilmNativeMessages.some(message => message?.type === 'MYFILM_FULLSCREEN' && message.active === true)
  )).toBe(true);

  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => MyFilmPlatform.isFullscreen())).toBe(false);
  await expect(page).toHaveURL(/\/movie\/27205$/);
  await expect(page.locator('.iframe-player-wrap iframe')).toHaveCount(1);

  const messages = await page.evaluate(() => window.__myfilmNativeMessages);
  expect(messages.some(message => message?.type === 'MYFILM_FULLSCREEN' && message.active === false)).toBe(true);
  expect(messages.some(message => message?.type === 'MYFILM_BACK_RESULT' && message.handled === true)).toBe(true);
});


test('TMDB episode skeleton keeps the series menu usable when external series providers are down', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tv', 'TV resilience behavior');
  await mockLifecycleApi(page, { seriesProvidersAvailable: false });
  await page.goto('/tv/125988');

  await expect(page.locator('.detail-title')).toHaveText('Silo');
  await expect(page.locator('.burger-ep-btn')).toHaveCount(1);
  await expect(page.locator('#now-playing-label')).toContainText('სეზონი 1');
  await expect(page.locator('.iframe-badge')).toContainText('ge.movie');
  await expect(page.locator('.native-video-frame')).toBeHidden();
  await expect(page.locator('.player-fullscreen-hit--iframe')).toHaveCount(1);
});
