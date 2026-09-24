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
  } finally {
    clearTimeout(timer);
  }
}

test('live: movie provider pool keeps at least two independent playable sources', { skip: !runLive, timeout: 180_000 }, async () => {
  const canaries = {
    'adjaranetto.com': 'Inception 2010',
    'Croconet.cam': 'Inception 2010',
    'ufasofilmebi.ge': 'Avatar 2 2022',
    'chemikino.com': 'Avatar 2009',
    'imovs.ge': 'Avatar 2009',
    'asia.com.ge': 'Squid Game',
    'geofilms.net': 'Borderlands',
    'kinolab.cc': 'Avatar 2009',
    'geosaitebi.tv': 'Avatar 2009',
  };

  const results = [];
  for (const [provider, query] of Object.entries(canaries)) {
    try {
      const englishTitle = query.replace(/\b(?:19|20)\d{2}\b/g, '').trim();
      const data = await workerJson(`/imovs?q=${encodeURIComponent(query)}&eng=${encodeURIComponent(englishTitle)}&source=${encodeURIComponent(provider)}`);
      const stream = data.players?.flatMap(player => player.streams || []).find(candidate => candidate.file || candidate.rawUrl);
      assert.ok(stream, `${provider} did not return a playable candidate`);
      await assertReachableStream(stream, provider);
      results.push({ provider, ok: true });
    } catch (error) {
      results.push({ provider, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ liveMovieProviders: results }));
  const working = results.filter(result => result.ok);
  assert.ok(working.length >= 2, `movie provider redundancy too low: ${working.length}/${results.length} working`);
});

test('live: series provider pool keeps at least one playable Silo source', { skip: !runLive, timeout: 120_000 }, async () => {
  const providers = ['adjaranetto.com', 'Croconet.cam', 'ufasofilmebi.ge', 'imovs.ge'];
  const results = [];
  for (const provider of providers) {
    try {
      const data = await workerJson(`/imovs-series?q=Silo&eng=Silo&source=${encodeURIComponent(provider)}&season=1&episode=1`);
      const stream = data.episodes?.flatMap(episode => episode.streams || []).find(candidate => candidate.file || candidate.rawUrl);
      assert.ok(stream, `${provider} did not return Silo S1E1`);
      results.push({ provider, ok: true });
    } catch (error) {
      results.push({ provider, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ liveSeriesProviders: results }));
  assert.ok(results.some(result => result.ok), 'no live Silo series provider returned episode 1');
});

test('live: at least one anime provider returns Jujutsu Kaisen episodes', { skip: !runLive, timeout: 120_000 }, async () => {
  const [animeB, animeTv] = await Promise.all([
    workerJson(`/animeb?q=${encodeURIComponent('Jujutsu Kaisen')}`).catch(() => ({ episodes: [] })),
    workerJson(`/animetv?q=${encodeURIComponent('Jujutsu Kaisen')}`).catch(() => ({ episodes: [] })),
  ]);
  const counts = {
    'animeb.ge': animeB.episodes?.length || 0,
    'animetv.ge': animeTv.episodes?.length || 0,
  };
  console.log(JSON.stringify({ liveAnimeProviders: counts }));
  assert.ok(Object.values(counts).some(count => count > 0), 'no anime provider returned Jujutsu Kaisen episodes');
});
