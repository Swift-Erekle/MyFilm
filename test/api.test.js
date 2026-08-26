import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('TMDB list items with CJK titles are merged with their English titles by id', async () => {
  const source = `${await readFile(new URL('../website/js/api.js', import.meta.url), 'utf8')}\n;globalThis.__API = API;`;
  const requests = [];
  const localized = {
    results: [
      { id: 1, name: 'Already English', original_name: 'Already English', original_language: 'en' },
      { id: 2, name: 'シン・仮面ライダー', original_name: 'シン・仮面ライダー', original_language: 'ja' },
      { id: 3, title: '變身', original_title: '變身', original_language: 'zh' },
    ],
  };
  const english = {
    results: [
      { id: 1, name: 'Already English', original_name: 'Already English', original_language: 'en' },
      { id: 2, name: 'Shin Kamen Rider', original_name: 'シン・仮面ライダー', original_language: 'ja' },
      { id: 3, title: 'Transformation', original_title: '變身', original_language: 'zh' },
    ],
  };
  const context = {
    URL,
    Map,
    console,
    CUSTOM_ANIMES: [],
    CONFIG: {
      TMDB_BASE_URL: 'https://example.test/api/tmdb',
      TMDB_LANGUAGE: 'ka-GE',
      TMDB_LANGUAGE_FALLBACK: 'en-US',
    },
    fetch: async url => {
      requests.push(String(url));
      const data = new URL(url).searchParams.get('language') === 'en-US' ? english : localized;
      return { ok: true, status: 200, json: async () => structuredClone(data) };
    },
  };

  vm.runInNewContext(source, context);
  const data = await context.__API.trending();

  assert.equal(data.results[1].name, 'Shin Kamen Rider');
  assert.equal(data.results[1].original_name, 'Shin Kamen Rider');
  assert.equal(data.results[2].title, 'Transformation');
  assert.equal(data.results[2].original_title, 'Transformation');
  assert.equal(requests.length, 2);
  assert.match(requests[1], /language=en-US/);
});
