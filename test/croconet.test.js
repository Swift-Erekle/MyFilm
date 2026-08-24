import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseCroconetMovieHls,
  croconetMediaIdentity,
  extractCroconetPrimaryHls,
} from '../src/providers/index.js';

test('Croconet ignores recommendation streams when the selected page only has a trailer', () => {
  const fixture = `
    <script>const trailer = "https://storage.croco.cam/treiler/1490/index.m3u8";</script>
    <section data-recommendations>
      <script>const unrelated = "https://storage7.croco.cam/serial/The_Umbrella_Academy_2019/1_1/index.m3u8";</script>
      <script>const unrelatedMovie = "https://storage5.croco.cam/movies/Harry_Potter_2011_GEO/index.m3u8";</script>
    </section>
  `;
  assert.deepEqual(extractCroconetPrimaryHls(fixture), []);
});

test('Croconet scopes extraction to the current movie before recommendations', () => {
  const current = 'https://storage1.croco.cam/movies/Inception_2010_GEO_SD/index.m3u8';
  const fixture = `
    <script>const movie = "${current}"; const duplicate = "${current}";</script>
    <script>const trailer = "https://storage.croco.cam/treiler/1843/index.m3u8";</script>
    <script>const recommendation = "https://storage.croco.cam/movies/Other_Movie_2019_GEO/index.m3u8";</script>
  `;
  assert.deepEqual(extractCroconetPrimaryHls(fixture), [current]);
  assert.deepEqual(croconetMediaIdentity(current), { title: 'Inception', year: 2010 });
  assert.equal(chooseCroconetMovieHls([current], ['Inception'], 2010), current);
});

test('Croconet rejects an older same-title movie when the requested year differs', () => {
  const oldMovie = 'https://storage.croco.cam/movies/The_Odyssey_2016_GEO/index.m3u8';
  assert.equal(chooseCroconetMovieHls([oldMovie], ['The Odyssey'], 2026), '');
});
