const BASE_TITLE = 'MyFilm — ონლაინ კინო';
const BASE_DESCRIPTION = 'უყურე ფილმებს, სერიალებსა და ანიმეს ქართულად MyFilm-ზე.';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function routeInfo(pathname) {
  const match = pathname.match(/^\/(movie|tv|anime)\/(\d+)\/?$/);
  if (match) return { kind: match[1], id: match[2] };
  const search = pathname.match(/^\/search\/([^/]+)\/?$/);
  if (search) {
    try { return { kind: 'search', query: decodeURIComponent(search[1]) }; }
    catch { return { kind: 'search', query: search[1] }; }
  }
  return null;
}

async function tmdbDetail(route, env) {
  const token = env.TMDB_READ_TOKEN;
  const apiKey = env.TMDB_API_KEY;
  if (!route || !['movie', 'tv', 'anime'].includes(route.kind) || (!token && !apiKey)) return null;
  const mediaType = route.kind === 'movie' ? 'movie' : 'tv';
  const url = new URL(`https://api.themoviedb.org/3/${mediaType}/${route.id}`);
  url.searchParams.set('language', 'ka-GE');
  if (apiKey && !token) url.searchParams.set('api_key', apiKey);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function renderSeoIndex(indexHtml, requestUrl, env = {}) {
  const url = new URL(requestUrl);
  const route = routeInfo(url.pathname);
  const detail = await tmdbDetail(route, env);
  const name = detail?.title || detail?.name || (route?.kind === 'search' ? `ძიება: ${route.query}` : 'MyFilm');
  const title = name === 'MyFilm' ? BASE_TITLE : `${name} — MyFilm`;
  const description = detail?.overview || (route?.kind === 'search' ? `MyFilm-ის ძიების შედეგები: ${route.query}` : BASE_DESCRIPTION);
  const image = detail?.backdrop_path || detail?.poster_path
    ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path || detail.poster_path}`
    : `${url.origin}/favicon.png`;
  const canonical = `${url.origin}${url.pathname}`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': route && ['movie', 'tv', 'anime'].includes(route.kind) ? (route.kind === 'movie' ? 'Movie' : 'TVSeries') : 'WebSite',
    name,
    description,
    url: canonical,
    image,
    inLanguage: 'ka',
  };
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`,
  ].join('\n  ');
  return indexHtml
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(/\s*<meta\s+name=["']description["'][^>]*>/i, '')
    .replace('</head>', `  ${tags}\n</head>`);
}

export function renderRobots(origin) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /hls\nDisallow: /play\nSitemap: ${origin}/sitemap.xml\n`;
}

export function renderSitemap(origin) {
  const paths = ['/', '/movies', '/tv', '/anime', '/animation', '/search'];
  const urls = paths.map(path => `  <url><loc>${origin}${path}</loc><changefreq>daily</changefreq></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}
