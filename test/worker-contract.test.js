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

test('TMDB proxy requires a server-side credential', async () => {
  const response = await worker.fetch(new Request('https://myfilm.example/api/tmdb/movie/popular'), env);
  const data = await response.json();
  assert.equal(response.status, 503);
  assert.equal(data.error, 'tmdb_not_configured');
});

test('AnimeTV direct-page route rejects arbitrary hosts', async () => {
  const response = await worker.fetch(new Request('https://myfilm.example/animetv_page?url=https%3A%2F%2Fevil.example%2Fpage.html'), env);
  assert.equal(response.status, 400);
});
