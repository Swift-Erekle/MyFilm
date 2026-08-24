import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare.js';

const env = {
  PUBLIC_ORIGIN: 'https://myfilm.example',
  ALLOWED_ORIGINS: 'https://myfilm.example',
};

test('worker returns the normalized JSON contract', async () => {
  const response = await worker.fetch(new Request('https://myfilm.example/?ping=1'), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.provider, null);
  assert.equal(data.errorCode, null);
});

test('worker denies an unknown CORS origin during preflight', async () => {
  const response = await worker.fetch(new Request('https://myfilm.example/imovs', {
    method: 'OPTIONS',
    headers: { Origin: 'https://untrusted.example' },
  }), env);
  assert.equal(response.status, 403);
});

test('worker blocks SSRF targets before fetching upstream', async () => {
  const response = await worker.fetch(new Request('https://myfilm.example/play?u=https%3A%2F%2F127.0.0.1%2Fadmin'), env);
  const data = await response.json();
  assert.equal(response.status, 403);
  assert.equal(data.error, 'proxy_target_denied');
});

test('TMDB proxy falls back to the built-in v3 key', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async input => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const response = await worker.fetch(new Request('https://myfilm.example/api/tmdb/movie/popular'), env);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(data.results, []);
    assert.match(requestedUrl, /api_key=8265bd1679663a7ea12ac168da84d2e8/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AnimeTV direct-page route rejects arbitrary hosts', async () => {
  const response = await worker.fetch(new Request('https://myfilm.example/animetv_page?url=https%3A%2F%2Fevil.example%2Fpage.html'), env);
  assert.equal(response.status, 400);
});

test('ge.movie status distinguishes a playable catalog ID from a missing ID', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const target = new URL(String(input));
    if (target.searchParams.get('id') === '27205') {
      return new Response(JSON.stringify([{ file: '[HD]{ქართული}https://cdn.example.com/inception.m3u8' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('', { status: 404 });
  };
  try {
    const availableResponse = await worker.fetch(new Request('https://myfilm.example/api/ge-movie/status?type=movie&id=27205'), env);
    const missingResponse = await worker.fetch(new Request('https://myfilm.example/api/ge-movie/status?type=movie&id=999999999'), env);
    assert.equal((await availableResponse.json()).available, true);
    assert.equal((await missingResponse.json()).available, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Croconet route uses validated web discovery after its internal search misses', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async input => {
    const target = String(input);
    requested.push(target);
    if (target.includes('croconet.cam/search/')) return new Response('<html><body>no internal matches</body></html>', { status: 200 });
    if (target.includes('google.com/search')) return new Response('<a href="/search?q=x&emsg=SG_REL">blocked</a>', { status: 200 });
    if (target.includes('search.brave.com/search')) {
      return new Response('<a href="https://croconet.cam/movie/2055/Inception"><h3>Inception (2010)</h3></a>', { status: 200 });
    }
    if (target === 'https://croconet.cam/movie/2055/Inception') {
      return new Response('<title>Inception (2010)</title><script>const file="https://cdn.croco.cam/Inception_2010/master.m3u8";</script>', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  try {
    const response = await worker.fetch(new Request('https://myfilm.example/imovs?q=Inception%202010&eng=Inception&source=Croconet.cam'), env);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.players.length, 1);
    assert.equal(data.players[0].source, 'Croconet.cam');
    assert.match(data.players[0].streams[0].file, /^https:\/\/myfilm\.example\/hls\?/);
    assert.ok(requested.some(target => target.includes('google.com/search')));
    assert.ok(requested.some(target => target.includes('search.brave.com/search')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
