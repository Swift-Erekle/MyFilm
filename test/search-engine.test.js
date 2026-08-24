import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSearchResultCandidates, searchWebForProvider } from '../src/providers/index.js';

const CROCO = { id: 'Croconet.cam', baseUrl: 'https://croconet.cam/' };

test('search-result extraction accepts only HTTPS detail links on the requested provider', () => {
  const fixture = `
    <a href="/url?q=https%3A%2F%2Fcroconet.cam%2Fmovie%2F2055%2FInception&amp;sa=U"><h3>Inception (2010)</h3></a>
    <a href="https://evil.example/movie/Inception">Inception mirror</a>
    <a href="http://croconet.cam/movie/2055/Inception">insecure result</a>
    <a href="https://croconet.cam/search/Inception">provider search page</a>
  `;
  const candidates = extractSearchResultCandidates(fixture, 'https://www.google.com/search?q=test', CROCO);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://croconet.cam/movie/2055/Inception');
  assert.match(candidates[0].title, /Inception/);
});

test('web fallback tries Brave immediately when Google serves a bot-block page', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async target => {
    calls.push(String(target));
    if (String(target).includes('google.com')) {
      return new Response('<html><a href="/search?q=test&emsg=SG_REL">blocked</a></html>', { status: 200 });
    }
    return new Response('<a href="https://croconet.cam/movie/2055/Inception"><h3>Inception (2010)</h3></a>', { status: 200 });
  };
  try {
    const candidates = await searchWebForProvider(CROCO, { engQuery: 'Inception', year: 2010 });
    assert.equal(candidates[0].url, 'https://croconet.cam/movie/2055/Inception');
    assert.equal(calls.length, 2);
    assert.match(calls[0], /google\.com/);
    assert.match(calls[1], /search\.brave\.com/);
    assert.match(decodeURIComponent(calls[0]), /site:croconet\.cam "Inception" 2010/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
