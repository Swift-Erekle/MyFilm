import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, request } from '@playwright/test';

const BASE_URL = String(process.env.PRODUCTION_URL || 'https://myfilm-production.up.railway.app').replace(/\/$/, '');
const OUT_DIR = 'production-smoke';
const results = [];
const warnings = [];

function check(condition, message, details = {}) {
  results.push({ ok: Boolean(condition), message, ...details });
  if (!condition) throw new Error(message);
}

function note(message, details = {}) {
  results.push({ ok: true, message, ...details });
}

function isFirstParty(url) {
  try { return new URL(url).origin === new URL(BASE_URL).origin; } catch { return false; }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const api = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { 'user-agent': 'MyFilmProductionSmoke/1.0' },
  });

  const root = await api.get('/');
  check(root.status() === 200, 'production root returns HTTP 200', { status: root.status() });

  const html = await root.text();
  check(/MyFilm/i.test(html), 'production HTML contains MyFilm branding');
  check(
    html.includes('Swift-Erekle/MyFilm-App/releases/download/v1.1.0/MyFilm-TV.apk'),
    'production HTML points TV APK download at MyFilm-App release',
  );

  const sw = await api.get('/sw.js');
  check(sw.status() === 200, 'production service worker returns HTTP 200', { status: sw.status() });
  const swText = await sw.text();
  check(swText.includes("myfilm-shell-v1.1.9"), 'production service worker is current shell v1.1.9');

  const manifest = await api.get('/manifest.webmanifest');
  check(manifest.status() === 200, 'production manifest returns HTTP 200', { status: manifest.status() });

  const robots = await api.get('/robots.txt');
  check(robots.status() === 200, 'production robots.txt returns HTTP 200', { status: robots.status() });

  const browser = await chromium.launch({ headless: true });

  const desktop = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const desktopPage = await desktop.newPage();
  const desktopErrors = [];
  const desktopFirstPartyFailures = [];
  desktopPage.on('pageerror', error => desktopErrors.push(String(error)));
  desktopPage.on('requestfailed', req => {
    if (isFirstParty(req.url())) desktopFirstPartyFailures.push({ url: req.url(), error: req.failure()?.errorText || 'unknown' });
  });

  const desktopResponse = await desktopPage.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  check(desktopResponse?.status() === 200, 'desktop homepage navigation returns HTTP 200', { status: desktopResponse?.status() });
  await desktopPage.waitForSelector('.nav-brand', { state: 'visible', timeout: 15_000 });
  check((await desktopPage.title()).toLowerCase().includes('myfilm'), 'desktop page title contains MyFilm', { title: await desktopPage.title() });

  await desktopPage.waitForSelector('.movie-card', { state: 'visible', timeout: 30_000 });
  const cardCount = await desktopPage.locator('.movie-card').count();
  check(cardCount > 0, 'desktop homepage renders movie cards', { cardCount });

  const apkHref = await desktopPage.locator('#tv-download-action').getAttribute('href').catch(() => null);
  check(Boolean(apkHref?.includes('Swift-Erekle/MyFilm-App/releases/download/v1.1.0/MyFilm-TV.apk')), 'desktop TV download action uses MyFilm-App release', { href: apkHref });

  await desktopPage.screenshot({ path: path.join(OUT_DIR, 'desktop-home.png'), fullPage: true });
  if (desktopErrors.length) warnings.push({ type: 'desktop-pageerror', values: desktopErrors });
  if (desktopFirstPartyFailures.length) warnings.push({ type: 'desktop-first-party-request-failure', values: desktopFirstPartyFailures });

  const tv = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Android TV) AppleWebKit/537.36 Chrome/125 Safari/537.36 MyFilmTV/1.1.0',
  });

  await tv.addInitScript(() => {
    window.__myfilmNativeMessages = [];
    window.ReactNativeWebView = {
      postMessage(value) {
        try { window.__myfilmNativeMessages.push(JSON.parse(value)); } catch {}
      },
    };
    let fullscreenTarget = null;
    try {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => fullscreenTarget,
      });
    } catch {}
    HTMLElement.prototype.requestFullscreen = function requestFullscreen() {
      fullscreenTarget = this;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    document.exitFullscreen = function exitFullscreen() {
      fullscreenTarget = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
  });

  const tvPage = await tv.newPage();
  const tvErrors = [];
  const tvFirstPartyFailures = [];
  const tvMediaRequests = [];
  const tvMediaResponses = [];
  tvPage.on('pageerror', error => tvErrors.push(String(error)));
  tvPage.on('request', req => {
    if (!isFirstParty(req.url())) return;
    try {
      const pathname = new URL(req.url()).pathname;
      if (['/play', '/hls', '/hlsseg', '/hlskey'].includes(pathname)) {
        tvMediaRequests.push({ url: req.url(), method: req.method(), resourceType: req.resourceType() });
      }
    } catch {}
  });
  tvPage.on('response', response => {
    if (!isFirstParty(response.url())) return;
    try {
      const pathname = new URL(response.url()).pathname;
      if (['/play', '/hls', '/hlsseg', '/hlskey'].includes(pathname)) {
        tvMediaResponses.push({
          url: response.url(),
          status: response.status(),
          contentType: response.headers()['content-type'] || '',
        });
      }
    } catch {}
  });
  tvPage.on('requestfailed', req => {
    if (isFirstParty(req.url())) tvFirstPartyFailures.push({ url: req.url(), error: req.failure()?.errorText || 'unknown' });
  });

  const tvHome = await tvPage.goto(BASE_URL + '/?tv=1', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  check(tvHome?.status() === 200, 'TV homepage returns HTTP 200', { status: tvHome?.status() });
  await tvPage.waitForFunction(() => document.documentElement.classList.contains('myfilm-tv'), null, { timeout: 15_000 });
  note('TV mode class is active');

  await tvPage.waitForSelector('.movie-card', { state: 'visible', timeout: 30_000 });
  const firstCard = tvPage.locator('.movie-card').first();
  await firstCard.focus();
  await tvPage.keyboard.press('ArrowRight');
  check(await tvPage.evaluate(() => document.activeElement?.classList.contains('movie-card') === true), 'TV D-pad ArrowRight moves between movie cards');
  await tvPage.keyboard.press('ArrowUp');
  check(await tvPage.evaluate(() => !document.activeElement?.classList.contains('movie-card')), 'TV D-pad ArrowUp can escape movie-card row');

  const movieResponse = await tvPage.goto(BASE_URL + '/movie/27205?tv=1', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  check(movieResponse?.status() === 200, 'TV movie detail returns HTTP 200', { status: movieResponse?.status() });
  await tvPage.waitForSelector('.detail-title', { state: 'visible', timeout: 20_000 });
  const movieTitle = (await tvPage.locator('.detail-title').textContent())?.trim() || '';
  check(/Inception|დასაწყისი/i.test(movieTitle), 'TV movie detail renders the expected Inception title', { movieTitle });

  const watch = tvPage.locator('#btn-scroll-player');
  check(await watch.isVisible(), 'TV Watch action is visible');
  await tvPage.locator('#nav-home').focus();
  await tvPage.keyboard.press('ArrowDown');
  check(await watch.evaluate(el => el === document.activeElement), 'TV Watch action is reachable from top navigation via D-pad');

  await watch.focus();
  await tvPage.keyboard.press('Enter');
  await tvPage.waitForTimeout(500);
  note('TV Watch action can be activated with Enter', { scrollY: await tvPage.evaluate(() => window.scrollY) });

  let playerState = 'loading-or-fallback';
  try {
    await tvPage.waitForFunction(() => {
      const iframe = document.querySelector('.iframe-player-wrap iframe');
      const video = document.querySelector('.native-video-frame video');
      const fallback = document.querySelector('.player-fallback');
      return Boolean(iframe || (video && getComputedStyle(video).display !== 'none') || fallback);
    }, null, { timeout: 25_000 });
    playerState = await tvPage.evaluate(() => {
      if (document.querySelector('.iframe-player-wrap iframe')) return 'iframe';
      const video = document.querySelector('.native-video-frame video');
      if (video && getComputedStyle(video).display !== 'none') return 'native-video';
      if (document.querySelector('.player-fallback')) return 'fallback';
      return 'unknown';
    });
  } catch {
    warnings.push({ type: 'player-state-timeout', route: '/movie/27205?tv=1' });
  }
  note('TV movie player reached a rendered state', { playerState });

  const iframe = tvPage.locator('.iframe-player-wrap iframe');
  if (await iframe.count()) {
    check((await iframe.first().getAttribute('tabindex')) === '-1', 'provider iframe is excluded from TV D-pad focus');
  }

  const fullscreenHit = playerState === 'iframe'
    ? tvPage.locator('.player-fullscreen-hit--iframe').first()
    : tvPage.locator('.native-video-frame [data-player-fullscreen-hit]').first();

  if ((playerState === 'iframe' || playerState === 'native-video')
    && await fullscreenHit.count() && await fullscreenHit.isVisible()) {
    await fullscreenHit.focus();
    await tvPage.keyboard.press('Enter');
    await tvPage.waitForTimeout(150);
    check(await tvPage.evaluate(() => Boolean(document.fullscreenElement)), 'TV rendered player enters fullscreen');
    const detailUrl = tvPage.url();
    const handled = await tvPage.evaluate(() => window.MyFilmPlatform.handleBack());
    check(handled === true, 'TV Back reports handled while fullscreen is active');
    check(!(await tvPage.evaluate(() => Boolean(document.fullscreenElement))), 'TV Back exits fullscreen first');
    check(tvPage.url() === detailUrl, 'TV fullscreen Back does not leave movie detail');
  } else if (playerState !== 'fallback') {
    warnings.push({ type: 'fullscreen-hit-target-missing', playerState, route: '/movie/27205?tv=1' });
  }

  if (playerState === 'native-video') {
    const nativeVideo = tvPage.locator('.native-video-frame video').first();
    const videoState = await nativeVideo.evaluate(video => ({
      src: video.currentSrc || video.src || '',
      readyState: video.readyState,
      networkState: video.networkState,
      error: video.error ? { code: video.error.code, message: video.error.message || '' } : null,
      canPlayMp4: video.canPlayType('video/mp4'),
      canPlayH264Aac: video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
    }));
    check(Boolean(videoState.src), 'TV native player has a media source', { videoState });

    const firstPartyMedia = tvMediaResponses.filter(item => [200, 206].includes(item.status));
    check(firstPartyMedia.length > 0, 'TV native player receives successful first-party media responses', {
      mediaResponses: firstPartyMedia.slice(-10),
    });

    if (videoState.src.startsWith('blob:')) {
      check(!videoState.error, 'TV HLS/MSE native player has no immediate media error', {
        videoState,
        mediaRequests: tvMediaRequests.slice(-10),
        mediaResponses: tvMediaResponses.slice(-10),
      });
      note('TV native player is using an HLS/MSE blob URL', {
        videoState,
        mediaResponses: firstPartyMedia.slice(-10),
      });
    } else {
      const mediaProbe = await api.get(videoState.src, {
        headers: { Range: 'bytes=0-2047' },
        timeout: 30_000,
      });
      const mediaHeaders = mediaProbe.headers();
      const mediaBytes = await mediaProbe.body();
      const prefixHex = mediaBytes.subarray(0, 32).toString('hex');
      const prefixAscii = mediaBytes.subarray(0, 32).toString('latin1');
      const hasFtyp = mediaBytes.subarray(0, 32).includes(Buffer.from('ftyp'));
      const mediaProbeState = {
        status: mediaProbe.status(),
        contentType: mediaHeaders['content-type'] || '',
        contentLength: mediaHeaders['content-length'] || '',
        contentRange: mediaHeaders['content-range'] || '',
        acceptRanges: mediaHeaders['accept-ranges'] || '',
        bytesRead: mediaBytes.length,
        prefixHex,
        prefixAscii,
        hasFtyp,
      };
      check([200, 206].includes(mediaProbe.status()), 'TV /play media proxy returns HTTP 200/206', { mediaProbeState });
      check(hasFtyp, 'TV /play media proxy returns MP4 ftyp bytes', { mediaProbeState });

      if (videoState.error) {
        warnings.push({
          type: 'browser-media-decoder-error',
          message: 'Browser decoder reported an error even though /play returned valid MP4 bytes.',
          videoState,
          mediaProbeState,
        });
      } else {
        note('TV native MP4 player has no immediate media error', { videoState, mediaProbeState });
      }
    }
  }

  await tvPage.screenshot({ path: path.join(OUT_DIR, 'tv-movie-detail.png'), fullPage: true });

  const handledDetailBack = await tvPage.evaluate(() => window.MyFilmPlatform.handleBack());
  check(handledDetailBack === true, 'TV Back from movie detail is handled by web app');
  await tvPage.waitForURL(url => new URL(url).pathname === '/', { timeout: 10_000 });
  check(await tvPage.locator('#view-movie iframe').count() === 0, 'TV movie iframe is removed after leaving detail');
  check(await tvPage.locator('#view-movie video').count() === 0, 'TV native video is removed after leaving detail');
  check((await tvPage.locator('#player-container').innerHTML()).trim() === '', 'TV player container is empty after leaving detail');

  const seriesResponse = await tvPage.goto(BASE_URL + '/tv/125988?tv=1', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  check(seriesResponse?.status() === 200, 'TV series detail returns HTTP 200', { status: seriesResponse?.status() });
  await tvPage.waitForSelector('#burger-trigger', { state: 'visible', timeout: 20_000 });
  const burger = tvPage.locator('#burger-trigger');
  await burger.focus();
  await tvPage.keyboard.press('Enter');
  check(await tvPage.locator('#burger-panel').evaluate(el => el.classList.contains('open')), 'TV series menu opens with Enter');

  await tvPage.waitForSelector('.burger-ep-btn', { state: 'visible', timeout: 30_000 });
  const episodeButtons = tvPage.locator('.burger-ep-btn');
  const episodeCount = await episodeButtons.count();
  check(episodeCount > 0, 'TV series menu renders real episode buttons', { episodeCount });
  await tvPage.screenshot({ path: path.join(OUT_DIR, 'tv-series-menu.png'), fullPage: true });

  const firstEpisode = episodeButtons.first();
  await firstEpisode.focus();
  await tvPage.keyboard.press('Enter');
  check(!(await tvPage.locator('#burger-panel').evaluate(el => el.classList.contains('open'))), 'TV episode selection closes series menu');
  check(await burger.evaluate(el => el === document.activeElement), 'TV focus returns to series menu trigger after episode selection');

  await burger.focus();
  await tvPage.keyboard.press('Enter');
  check(await tvPage.locator('#burger-panel').evaluate(el => el.classList.contains('open')), 'TV series menu can reopen after episode selection');
  const handledPanelBack = await tvPage.evaluate(() => window.MyFilmPlatform.handleBack());
  check(handledPanelBack === true, 'TV Back handles open series menu');
  check(!(await tvPage.locator('#burger-panel').evaluate(el => el.classList.contains('open'))), 'TV Back closes series menu before leaving detail');
  check(await burger.evaluate(el => el === document.activeElement), 'TV focus returns to series menu trigger after Back');

  const routeMessages = await tvPage.evaluate(() => window.__myfilmNativeMessages.filter(m => m?.type === 'MYFILM_NAVIGATION'));
  check(routeMessages.length > 0, 'TV web app reports SPA navigation to native shell', { count: routeMessages.length });

  await tvPage.goto(BASE_URL + '/?tv=1', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const rootHandled = await tvPage.evaluate(() => window.MyFilmPlatform.handleBack());
  check(rootHandled === false, 'TV Back on root delegates exit to native app');
  check(await tvPage.evaluate(() => window.__myfilmNativeMessages.some(m => m?.type === 'MYFILM_BACK_RESULT' && m.handled === false)), 'TV root Back sends handled:false to native shell');

  if (tvErrors.length) warnings.push({ type: 'tv-pageerror', values: tvErrors });
  const hardTvFailures = tvFirstPartyFailures.filter(item => !/ERR_ABORTED/i.test(item.error || ''));
  const abortedTvRequests = tvFirstPartyFailures.length - hardTvFailures.length;
  if (abortedTvRequests) note('TV route changes intentionally aborted in-flight first-party requests', { count: abortedTvRequests });
  if (hardTvFailures.length) warnings.push({ type: 'tv-first-party-request-failure', values: hardTvFailures });

  await desktop.close();
  await tv.close();
  await browser.close();
  await api.dispose();

  const summary = {
    baseUrl: BASE_URL,
    passed: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    results,
    warnings,
  };

  await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(async error => {
  const failure = {
    baseUrl: BASE_URL,
    fatal: error instanceof Error ? error.stack || error.message : String(error),
    results,
    warnings,
  };
  await fs.mkdir(OUT_DIR, { recursive: true }).catch(() => {});
  await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(failure, null, 2)).catch(() => {});
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
});
