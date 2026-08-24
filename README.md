# MyFilm

ქართული ფილმების, სერიალებისა და ანიმეს კატალოგი მრავალწყაროიანი player-ით. Railway არის მთავარი web origin; იგივე `cloudflare.js` Cloudflare Worker-ზეც იბანდლება.

## ლოკალური გაშვება

1. დააკოპირე `.env.example` როგორც `.env` და მიუთითე `TMDB_READ_TOKEN`.
2. გაუშვი `npm install`.
3. გაუშვი `npm start` და გახსენი `http://localhost:8080`.

TMDB token მხოლოდ server/Worker გარემოში ინახება და browser-ში არ იგზავნება.

## შემოწმება

- `npm run check` — JavaScript syntax.
- `npm test` — fixture, security, SEO და Worker contract ტესტები.
- `npm run test:browser` — desktop, mobile და TV viewport-ები.
- `RUN_LIVE_SCRAPER_TESTS=1 npm run test:live` — რეალური provider canary-ები (PowerShell-ში ჯერ `$env:RUN_LIVE_SCRAPER_TESTS='1'`).
- `npm run diagnose:providers -- "Avatar 2009"` — თითოეული movie provider-ის მოკლე დიაგნოსტიკა.
- `npm run worker:dry-run` — Cloudflare bundle/config შემოწმება deploy-ის გარეშე.

## Railway

Start command არის `npm start`. გარემოში დააყენე:

- `PUBLIC_ORIGIN=https://<railway-domain>`
- `ALLOWED_ORIGINS=https://<railway-domain>`
- `TMDB_READ_TOKEN=<tmdb-read-token>`

## Cloudflare Worker

1. `.dev.vars.example` დააკოპირე `.dev.vars`-ად მხოლოდ ლოკალური Worker-ისთვის.
2. production secret შეიყვანე ინტერაქტიულად: `npx wrangler secret put TMDB_READ_TOKEN`.
3. შეამოწმე `npm run worker:types` და `npm run worker:dry-run`.

Repository-ში secret, `.env`, `.dev.vars`, test trace ან build artifact არ უნდა მოხვდეს.
