import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRobots, renderSeoIndex, renderSitemap } from '../src/seo.js';

test('SEO renderer emits canonical and JSON-LD without credentials', async () => {
  const html = '<html><head><meta name="description" content="old"><title>Old</title></head><body></body></html>';
  const output = await renderSeoIndex(html, 'https://myfilm.example/movie/27205', {});
  assert.match(output, /<link rel="canonical" href="https:\/\/myfilm\.example\/movie\/27205">/);
  assert.match(output, /application\/ld\+json/);
  assert.doesNotMatch(output, /content="old"/);
});

test('robots and sitemap use the public origin', () => {
  assert.match(renderRobots('https://myfilm.example'), /Sitemap: https:\/\/myfilm\.example\/sitemap\.xml/);
  assert.match(renderSitemap('https://myfilm.example'), /<loc>https:\/\/myfilm\.example\/movies<\/loc>/);
});
