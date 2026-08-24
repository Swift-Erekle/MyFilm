import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS,
  bestTitleCandidate,
  extractPlayerUrls,
  fetchWithTimeout,
} from '../src/providers/index.js';

const PLAYER_FIXTURES = {
  'adjaranetto.com': '<iframe data-src="https://mykadri.vip/embed/100"></iframe>',
  'Croconet.cam': '<video src="https://storage1.croco.cam/demo/master.m3u8"></video>',
  'ufasofilmebi.ge': '<iframe src="https://video.sibnet.ru/shell.php?videoid=100"></iframe>',
  'chemikino.com': '<button data-player="https://csst.online/embed/100">ქართული</button>',
  'imovs.ge': '<div data-video="https://incvideo1.online/media/demo.mp4"></div>',
  'asia.com.ge': '<iframe src="https://catalog.allarknow.online/?imdb=tt100"></iframe>',
  'geofilms.net': '<video src="https://cdn.geofilms.net/demo/master.m3u8"></video>',
  'kinolab.cc': '<video src="https://ftp.kinolab.cc/demo/master.m3u8"></video>',
  'geosaitebi.tv': '<iframe src="https://ok.ru/videoembed/100"></iframe>',
  'animeb.ge': '<iframe src="https://my.mail.ru/video/embed/100"></iframe>',
  'animetv.ge': '<iframe src="https://drive.google.com/file/d/100/preview"></iframe>',
};

test('every scraper provider has a playable HTML fixture', () => {
  const scraperProviders = PROVIDERS.filter(provider => provider.mode !== 'direct');
  assert.deepEqual(scraperProviders.map(provider => provider.id).sort(), Object.keys(PLAYER_FIXTURES).sort());
  for (const provider of scraperProviders) {
    const urls = extractPlayerUrls(PLAYER_FIXTURES[provider.id], provider.baseUrl);
    assert.ok(urls.length > 0, `${provider.id} fixture did not produce a player`);
    assert.ok(urls.every(url => !/(?:youtube|trailer|banner|\.css|\.js)(?:[/?#]|$)/i.test(url)), `${provider.id} accepted a non-player asset`);
  }
});

test('search fixtures choose the matching title instead of the first result', () => {
  const candidates = [
    { title: 'Jujutsu Kaisen fan trailer', url: 'https://example.test/wrong' },
    { title: 'Jujutsu Kaisen / ჯუჯუცუ კაისენი', url: 'https://example.test/correct' },
    { title: 'Kaisen: unrelated documentary', url: 'https://example.test/other' },
  ];
  assert.equal(bestTitleCandidate(candidates, ['Jujutsu Kaisen'])?.url, 'https://example.test/correct');
});

test('temporary provider errors are retried once', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(attempts === 1 ? 'temporary' : 'ok', { status: attempts === 1 ? 503 : 200 });
  };
  try {
    const response = await fetchWithTimeout('https://provider.test/', {}, { timeoutMs: 100 });
    assert.equal(response.status, 200);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a hanging provider is terminated by its timeout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_target, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  try {
    await assert.rejects(
      fetchWithTimeout('https://provider.test/', {}, { timeoutMs: 25, retry: false }),
      /provider_timeout|abort/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
