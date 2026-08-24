import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAssignedObject,
  extractPlayerUrls,
  isChallengePage,
  isPlayableCandidate,
  parsePlayerArrays,
  titleScore,
} from '../src/providers/common.js';

test('normal pages mentioning Cloudflare assets are not treated as challenge pages', () => {
  const html = '<html><head><script src="https://cdnjs.cloudflare.com/a.js"></script></head><body>Anime catalog</body></html>';
  assert.equal(isChallengePage(html, 200), false);
  assert.equal(isChallengePage('<title>Just a moment...</title><div class="cf-chl-widget"></div>', 200), true);
});

test('title scoring prefers an exact title over a loosely related title', () => {
  assert.ok(titleScore('Jujutsu Kaisen', 'Jujutsu Kaisen Season 3') > titleScore('Jujutsu Kaisen', 'Clevatess Season 2'));
});

test('AnimeTV parser supports declaration followed by assignment', () => {
  const fixture = `
    let allPlayers = {};
    allPlayers = {
      player1: ['https://drive.google.com/file/d/one/preview', 'https://drive.google.com/file/d/two/preview'],
      player2: ['https://vkvideo.ru/video_ext.php?id=1']
    };
  `;
  const objectSource = extractAssignedObject(fixture, 'allPlayers');
  const players = parsePlayerArrays(objectSource);
  assert.equal(players.length, 2);
  assert.equal(players[0].urls.length, 2);
  assert.equal(players[1].urls[0], 'https://vkvideo.ru/video_ext.php?id=1');
});

test('player extraction rejects trailers and advertising assets', () => {
  const html = `
    <iframe src="https://www.youtube.com/embed/trailer"></iframe>
    <iframe data-src="https://video.sibnet.ru/shell.php?videoid=44"></iframe>
    <a href="https://ads.example/banner.mp4">ad</a>
  `;
  assert.deepEqual(extractPlayerUrls(html, 'https://example.com/'), ['https://video.sibnet.ru/shell.php?videoid=44']);
});

test('player extraction rejects embeds known to fail in the application player', () => {
  const html = `
    <iframe src="https://vsembed.ru/embed/movie/tt100"></iframe>
    <iframe src="https://vidsrc-embed.ru/embed/movie/tt100"></iframe>
    <video src="https://cdn.example.com/movie/master.m3u8"></video>
  `;
  assert.deepEqual(extractPlayerUrls(html, 'https://example.com/'), ['https://cdn.example.com/movie/master.m3u8']);
});

test('retired myvi.ru embeds are never accepted as playable sources', () => {
  assert.equal(isPlayableCandidate('https://myvi.ru/player/embed/html/old-video'), false);
  assert.equal(isPlayableCandidate('https://videoapi.my.mail.ru/videos/embed/mail/video/1'), true);
});
