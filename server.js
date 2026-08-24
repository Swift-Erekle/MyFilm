import 'dotenv/config';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import worker from './cloudflare.js';
import { renderRobots, renderSeoIndex, renderSitemap } from './src/seo.js';

const app = express();
const directory = path.dirname(fileURLToPath(import.meta.url));
const websiteDirectory = path.join(directory, 'website');
const indexPath = path.join(websiteDirectory, 'index.html');
const port = Number(process.env.PORT || 8080);
const workerEndpoints = new Set([
  '/imovs', '/imovs-series', '/animeb', '/animes', '/animetv', '/animetv_page',
  '/play', '/hls', '/hlsseg', '/hlskey', '/api/providers/status', '/api/ge-movie/status',
]);

app.disable('x-powered-by');
app.set('trust proxy', 1);

function requestOrigin(req) {
  const configured = String(process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
  if (configured) return configured;
  const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`).split(',')[0].trim();
  return `${protocol}://${host}`;
}

async function sendWorkerResponse(res, response) {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) return res.end();
  Readable.fromWeb(response.body).pipe(res);
}

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(renderRobots(requestOrigin(req)));
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(renderSitemap(requestOrigin(req)));
});

app.use(express.static(websiteDirectory, { index: false, maxAge: '1h', etag: true }));

app.use(async (req, res, next) => {
  const pathname = new URL(req.originalUrl, requestOrigin(req)).pathname;
  if (!workerEndpoints.has(pathname) && !pathname.startsWith('/api/tmdb/')) return next();
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
      else if (value !== undefined) headers.set(key, value);
    }
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Readable.toWeb(req);
    const request = new Request(`${requestOrigin(req)}${req.originalUrl}`, {
      method: req.method,
      headers,
      body,
      duplex: body ? 'half' : undefined,
    });
    const response = await worker.fetch(request, process.env, { waitUntil: promise => void promise.catch(() => {}) });
    await sendWorkerResponse(res, response);
  } catch (error) {
    console.error(JSON.stringify({ message: 'worker_proxy_failed', path: pathname, error: error instanceof Error ? error.message : String(error) }));
    if (!res.headersSent) res.status(502).json({ ok: false, provider: null, errorCode: 'WORKER_PROXY_FAILED', message: 'Proxy სერვერი დროებით მიუწვდომელია.' });
  }
});

app.get('*path', async (req, res) => {
  try {
    const indexHtml = await readFile(indexPath, 'utf8');
    const rendered = await renderSeoIndex(indexHtml, `${requestOrigin(req)}${req.originalUrl}`, process.env);
    res.type('html').send(rendered);
  } catch (error) {
    console.error(JSON.stringify({ message: 'spa_render_failed', error: error instanceof Error ? error.message : String(error) }));
    res.status(500).send('MyFilm დროებით მიუწვდომელია.');
  }
});

app.listen(port, () => {
  console.log(JSON.stringify({ message: 'myfilm_server_started', port }));
});
