# MyFilm

ქართული ფილმების, სერიალების და ანიმეს კატალოგი მრავალწყაროიანი player-ით.

## Local

1. Install dependencies:

```bash
npm install
```

2. Run:

```bash
npm start
```

3. Open:

```text
http://localhost:8080
```

## Railway

Start command:

```bash
npm start
```

Required variable:

```env
PUBLIC_ORIGIN=https://<your-railway-domain>
```

Recommended variable:

```env
ALLOWED_ORIGINS=https://<your-railway-domain>
```

TMDB works with the built-in free v3 key. No paid token is required.

Optional overrides:

```env
TMDB_API_KEY=<your-free-tmdb-v3-key>
```

## Checks

```bash
npm run check
npm test
npm run test:browser
```

Live provider check:

```powershell
$env:RUN_LIVE_SCRAPER_TESTS='1'
npm run test:live
```

Cloudflare dry run:

```bash
npm run worker:dry-run
```

Do not commit `.env`, `.dev.vars`, secrets, traces, or build artifacts.
