import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare.js';

const runLive = process.env.RUN_LIVE_SCRAPER_TESTS === '1';
const env = { PUBLIC_ORIGIN: 'https://myfilm.example', ALLOWED_ORIGINS: 'https://myfilm.example' };

async function workerJson(path) {
  const response = await worker.fetch(new Request(`https://myfilm.example${path}`), env);
  return response.json();
}

async function assertReachableStream(stream, provider) {
  let target = stream.rawUrl || stream.file;
  let referer = `https://${provider}/`;
  let proxyRequest = null;
  try {
    const wrapper = new URL(stream.file || target);
    if (wrapper.hostname === 'myfilm.example' && wrapper.searchParams.get('u')) {
      target = wrapper.searchParams.get('u');
      referer = wrapper.searchParams.get('ref') || referer;
      proxyRequest = new Request(wrapper, { headers: { Range: 'bytes=0-2047' } });
    }
  } catch { /* assertion below reports malformed URLs */ }
  assert.ok(target && !/(?:youtube|youtu\.be|trailer|treiler)/i.test(target), `${provider} returned a trailer or empty URL`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const origin = new URL(referer).origin;
    const response = proxyRequest ? await worker.fetch(proxyRequest, env) : await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: referer,
        Origin: origin,
        Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,video/mp4,*/*',
        'Accept-Language': 'ka,en-US;q=0.9,en;q=0.8',
        Range: 'bytes=0-2047',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    assert.ok(response.status >= 200 && response.status < 400, `${provider} candidate returned HTTP ${response.status}`);
    await response.body?.cancel();
  } catch (error) {
    assert.fail(`${provider} candidate was not reachable: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

test('live: every movie provider returns a matching playable candidate', { skip: !runLive, timeout: 180_000 }, async () => {
  const canaries = {
    'adjaranetto.com': 'Inception 2010',
    'Croconet.cam': 'Inception 2010',
    'ufasofilmebi.ge': 'Avatar 2009',
    'chemikino.com': 'Avatar 2009',
    'imovs.ge': 'Avatar 2009',
    'asia.com.ge': 'Squid Game',
    // The legacy Inception player currently points at a DNS-dead host; this
    // maintained catalog entry exercises GeoFilms' current jwp `movie` shape.
    'geofilms.net': 'Borderlands',
    'kinolab.cc': 'Avatar 2009',
    'geosaitebi.tv': 'Avatar 2009',
  };
  for (const [provider, query] of Object.entries(canaries)) {
    const englishTitle = query.replace(/\b(?:19|20)\d{2}\b/g, '').trim();
    const data = await workerJson(`/imovs?q=${encodeURIComponent(query)}&eng=${encodeURIComponent(englishTitle)}&source=${encodeURIComponent(provider)}`);
    const stream = data.players?.flatMap(player => player.streams || []).find(candidate => candidate.file || candidate.rawUrl);
    assert.ok(stream, `${provider} did not return a playable candidate`);
    await assertReachableStream(stream, provider);
  }
});

test('live: Silo series and Jujutsu Kaisen anime return episodes', { skip: !runLive, timeout: 120_000 }, async () => {
  const series = await workerJson('/imovs-series?q=Silo&eng=Silo&source=adjaranetto.com&season=1&episode=1');
  assert.ok(series.episodes?.length, 'Adjaranet series did not return episodes');
  const animeB = await workerJson(`/animeb?q=${encodeURIComponent('Jujutsu Kaisen')}`);
  const animeTv = await workerJson(`/animetv?q=${encodeURIComponent('Jujutsu Kaisen')}`);
  assert.ok(animeB.episodes?.length, 'AnimeB did not return episodes');
  assert.ok(animeTv.episodes?.length, 'AnimeTV did not return episodes');
});
