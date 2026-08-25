import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const website = new URL('../website/', import.meta.url);

test('PWA manifest exposes installable MyFilm icons and standalone mode', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', website), 'utf8'));
  assert.equal(manifest.name, 'MyFilm');
  assert.equal(manifest.short_name, 'MyFilm');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url.startsWith('/'), true);
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    await assert.doesNotReject(readFile(new URL(icon.src.replace(/^\//, ''), website)));
  }
  await assert.doesNotReject(readFile(new URL('icons/apple-touch-icon.png', website)));
});

test('service worker never caches API, scraper, HLS, or player routes', async () => {
  const source = await readFile(new URL('sw.js', website), 'utf8');
  for (const route of ['/api/', '/imovs', '/imovs-series', '/animeb', '/animetv', '/play', '/hls']) {
    assert.match(source, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /request\.headers\.has\('range'\)/);
  assert.doesNotMatch(source.match(/const APP_SHELL = \[[\s\S]*?\];/)?.[0] || '', /['"]\/(?:api|imovs|play|hls)/);
});

test('PWA updates do not force a reload during initial install or active playback', async () => {
  const source = await readFile(new URL('../website/js/pwa.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!reloadRequested\) return/);
  assert.match(source, /if \(isPlayerActive\(\)\)/);
  assert.match(source, /reloadPending = true/);
});

test('website links the manifest, Apple icon, and TV-only APK', async () => {
  const html = await readFile(new URL('index.html', website), 'utf8');
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /v1\.1\.0\/MyFilm-TV\.apk/);
  assert.doesNotMatch(html, /v1\.0\.0\/MyFilm\.apk/);
});
