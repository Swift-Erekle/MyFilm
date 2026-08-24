import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedProxyUrl } from '../src/security.js';

test('proxy rejects local, private and plain HTTP targets', () => {
  assert.equal(isAllowedProxyUrl('http://csst.online/file.m3u8'), false);
  assert.equal(isAllowedProxyUrl('https://127.0.0.1/file.m3u8'), false);
  assert.equal(isAllowedProxyUrl('https://192.168.1.5/file.m3u8'), false);
});

test('proxy permits an allowlisted HTTPS media host', () => {
  assert.equal(isAllowedProxyUrl('https://storage.croco.cam/movies/demo/index.m3u8'), true);
  assert.equal(isAllowedProxyUrl('https://evil.example/file.m3u8'), false);
});
