import { extractAssignedObject, fetchWithTimeout as fetchProvider, inspectProviderHealth, parsePlayerArrays, searchExternalProvider, safeErrorCode, titleScore } from './src/providers/index.js';
import { corsOrigin, isAllowedProxyUrl, publicOrigin } from './src/security.js';

const DEFAULT_TMDB_API_KEY = '8265bd1679663a7ea12ac168da84d2e8';

export default {
  async fetch(req, env = {}, ctx = { waitUntil: () => {} }) {
    const allowedCorsOrigin = corsOrigin(req, env);
    if (req.method === "OPTIONS") {
      if (!allowedCorsOrigin) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedCorsOrigin,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, X-Requested-With, Authorization, Accept, Referer, Origin, Range",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }

    const url = new URL(req.url);
    const SELF = publicOrigin(req, env);

    const json = (obj, status = 200, extraHeaders = {}) => {
      const payload = {
        ...obj,
        provider: obj.provider ?? null,
        errorCode: obj.errorCode ?? (obj.ok === false ? safeErrorCode(obj.error || obj.message) : null),
        message: obj.message ?? (obj.ok === false ? 'წყარო დროებით მიუწვდომელია.' : null),
      };
      const headers = {
        "Content-Type": "application/json; charset=utf-8",
        Vary: "Origin",
        ...extraHeaders,
      };
      if (allowedCorsOrigin) headers["Access-Control-Allow-Origin"] = allowedCorsOrigin;
      return new Response(JSON.stringify(payload), {
        status,
        headers,
      });
    };

    function buildAnimeTvEpisodes(detailHtml, pageUrl) {
      const players = parsePlayerArrays(extractAssignedObject(detailHtml, 'allPlayers'));
      const maxEpisodes = Math.max(0, ...players.map(player => player.urls.length));
      const seasonMatch = pageUrl.match(/season-(\d+)/i) || detailHtml.match(/(?:სეზონი|season)\s*(\d+)/i);
      const season = seasonMatch ? Number(seasonMatch[1]) : 1;
      const episodes = [];
      for (let episode = 1; episode <= maxEpisodes; episode += 1) {
        const streams = players.flatMap((player, index) => {
          const rawUrl = player.urls[episode - 1];
          if (!rawUrl) return [];
          return [{
            file: `${SELF}/play?u=${encodeURIComponent(rawUrl)}&ref=${encodeURIComponent(pageUrl)}`,
            label: `F${index + 1}`,
            rawUrl,
            isIframe: true,
          }];
        });
        if (streams.length) episodes.push({ season, episode, title: `S${season} / E${episode}`, streams, playerIndex: 1, source: 'animetv.ge', candidate: streams[0].rawUrl, pageUrl });
      }
      return episodes;
    }

    if (url.pathname === '/api/providers/status') {
      const type = url.searchParams.get('type') || '';
      if (type && !['movie', 'tv', 'anime'].includes(type)) {
        return json({ ok: false, error: 'invalid_type', message: 'უცნობი მედიის ტიპი.' }, 400);
      }
      const cacheKey = new Request(`${url.origin}/api/providers/status?type=${encodeURIComponent(type)}`);
      const edgeCache = typeof caches !== 'undefined' ? caches.default : null;
      if (edgeCache) {
        const cached = await edgeCache.match(cacheKey);
        if (cached) return cached;
      }
      const providers = await inspectProviderHealth(type);
      const response = json({ ok: true, providers }, 200, { 'Cache-Control': 'public, max-age=120, s-maxage=300' });
      if (edgeCache) ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
      return response;
    }

    if (url.pathname.startsWith('/api/tmdb/')) {
      if (req.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
      const suffix = url.pathname.slice('/api/tmdb'.length);
      if (!/^\/(?:movie|tv|trending|discover|search|genre)\//.test(suffix)) {
        return json({ ok: false, error: 'tmdb_path_not_allowed', message: 'TMDB endpoint დაუშვებელია.' }, 400);
      }
      const apiKey = env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY;
      const target = new URL(`https://api.themoviedb.org/3${suffix}`);
      for (const [key, value] of url.searchParams) {
        if (!['api_key', 'token'].includes(key)) target.searchParams.append(key, value);
      }
      if (!target.searchParams.has('language')) target.searchParams.set('language', 'ka-GE');
      target.searchParams.set('api_key', apiKey);
      const headers = { Accept: 'application/json' };
      const response = await fetch(target, { headers, cf: { cacheTtl: 600, cacheEverything: true } });
      const outputHeaders = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=600', Vary: 'Origin' });
      if (allowedCorsOrigin) outputHeaders.set('Access-Control-Allow-Origin', allowedCorsOrigin);
      return new Response(response.body, { status: response.status, headers: outputHeaders });
    }

    /* ================= helpers ================= */
    function htmlHeaders() {
      return new Headers({
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8,ka;q=0.8",
        "Cache-Control": "no-cache",
        "Accept-Encoding": "identity",
      });
    }

    function withRef(h, ref) {
      if (!ref) return h;
      const fixed = /\/$/.test(ref) ? ref : ref + "/";
      h.set("Referer", fixed);
      try {
        h.set("Origin", new URL(fixed).origin);
      } catch { /* optional referer was not a valid absolute URL */ }
      return h;
    }

    function looksLikeCF(t) {
      const sample = String(t || "").slice(0, 30000);
      return /<title>\s*(?:Attention Required|Just a moment|Access denied)\b/i.test(sample) || /cf-chl-(?:opt|widget|bypass)|challenge-platform\/h\/g\/orchestrate|cloudflare ray id/i.test(sample);
    }

    async function getTextDirect(target, referer) {
      const h = withRef(htmlHeaders(), referer);
      try {
        const r = await fetchProvider(target, {
          headers: h,
          redirect: "follow",
          cf: { cacheTtl: 0, cacheEverything: false },
        }, { timeoutMs: 10_000 });
        return await r.text();
      } catch (e) {
        return `__FETCH_ERROR__:${String(e)}`;
      }
    }

    async function getText(target, referer) {
      const t1 = await getTextDirect(target, referer);
      if (t1 && !looksLikeCF(t1)) return t1;
      const abs = target.startsWith("http")
        ? target
        : "https://" + target.replace(/^\/+/, "");
      const t2 = await getTextDirect("https://r.jina.ai/" + abs, referer);
      return t2 || t1;
    }

    const uniq = (a) => {
      const s = new Set();
      return (a || []).filter((x) => {
        if (!x) return false;
        if (s.has(x)) return false;
        s.add(x);
        return true;
      });
    };

    const abs = (b, u) => {
      try {
        return new URL(u, b).toString();
      } catch {
        return u;
      }
    };

    function mediaHeaders() {
      return new Headers({
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8,ka;q=0.8",
        "Cache-Control": "no-cache",
        "Accept-Encoding": "identity",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Dest": "video",
      });
    }

    async function getResp(target, referer, range, kind = "hls") {
      const h = withRef(mediaHeaders(), referer);
      if (range) h.set("Range", range);
      if (kind === "hls")
        h.set("Accept", "application/vnd.apple.mpegurl,application/x-mpegURL,*/*");
      else h.set("Accept", "video/mp4,*/*");
      return await fetch(target, { headers: h, redirect: "follow" });
    }

    async function tryPlay(urlStr, referers, rangeHeader) {
      for (const ref of referers) {
        const r = await getResp(urlStr, ref, rangeHeader, "mp4");
        if ([200, 206].includes(r.status)) return r;
      }
      return await getResp(urlStr, null, rangeHeader, "mp4");
    }

    function extractMediaLinks(txt) {
      const out = [];
      const re = /https?:\/\/[^"'<>\\\s]+?\.(?:mp4|m3u8)(?:[^"'<>\\\s]*)?/gi;
      let m;
      while ((m = re.exec(txt)) !== null) out.push(m[0]);
      return uniq(out);
    }

    function extractGenericVideoUrls(txt) {
      // ზოგჯერ URL არ მთავრდება .mp4-ზე (მაგ. okcdn.ru/?type=3&id=...).
      const out = [];
      const re = /"(https?:\/\/[^"']+?)"/gi;
      let m;
      while ((m = re.exec(txt)) !== null) {
        const u = m[1];
        if (/https?:\/\/[^"']+/.test(u) && !/\.m3u8(?:\?|$)/i.test(u)) {
          // დავტოვოთ, თუ ეს player-ის audio/video URL-ებს ჰგავს.
          if (/okcdn\.ru\/\?/.test(u) || /mycdn|mail\.ru|vkuser|secvideo/i.test(u)) {
            out.push(u);
          }
        }
      }
      return uniq(out);
    }

    function decodeBase64Blobs(txt) {
      const out = [];
      const re =
        /(?:atob|Base64\.decode)\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/gi;
      let m;
      while ((m = re.exec(txt)) !== null) {
        try {
          out.push(atob(m[1]));
        } catch { /* ignore malformed base64 fragments */ }
      }
      return out.join("\n");
    }

    function resNum(labelOrUrl) {
      if (!labelOrUrl) return 0;
      const s = String(labelOrUrl);
      const m = s.match(/(^|[^0-9])(1[0-9]{3}|[0-9]{3})p(?![0-9])/i);
      return m ? parseInt(m[2], 10) : 0;
    }

    // MP4 წინ, HLS უკან.
    function normalizeAndSort(streams) {
      const out = [];
      (streams || []).forEach((it) => {
        const raw = (it && (it.file || it.src || it.url)) || "";
        let file = String(raw).trim();
        const label = (it && it.label ? String(it.label) : "") || "";

        if (!file) return;

        if (file.includes(",") && file.includes("http")) {
          file.split(",").map((s) => s.trim()).forEach((tok) => {
            const lm = tok.match(/\[(\d{3,4}p)\]/i);
            const url = tok.replace(/\[[^\]]+\]/g, "").trim();
            const fm =
              url.match(/(?:_|\.|\/)(\d{3,4}p)(?:[.\/?]|$)/i) ||
              url.match(/(\d{3,4}p)/i);
            const lab =
              (lm && lm[1]) ||
              (fm && fm[1]) ||
              (/\.m3u8/i.test(url) ? "HLS" : "auto");
            if (url) out.push({ file: url, label: lab });
          });
        } else {
          const fm =
            file.match(/(?:_|\.|\/)(\d{3,4}p)(?:[.\/?]|$)/i) ||
            file.match(/(\d{3,4}p)/i);
          const lab = label || (fm && fm[1]) || (/\.m3u8/i.test(file) ? "HLS" : "auto");
          out.push({ file, label: lab });
        }
      });

      const uniqed = uniq(out.map((x) => JSON.stringify(x))).map((s) =>
        JSON.parse(s)
      );

      uniqed.sort((a, b) => {
        const aIsHls = /\.m3u8/i.test(a.file) ? 1 : 0;
        const bIsHls = /\.m3u8/i.test(b.file) ? 1 : 0;
        if (bIsHls !== aIsHls) return aIsHls - bIsHls; // MP4(0) в†’ HLS(1)
        return resNum(b.label || b.file) - resNum(a.label || a.file);
      });

      return uniqed;
    }

    function pickTitle(html) {
      const m1 = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (m1 && m1[1]) return m1[1];
      const m2 = html.match(
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
      );
      if (m2 && m2[1]) return m2[1];
      const m3 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (m3 && m3[1]) return m3[1];
      return "";
    }

    function extractEnglishTitle(str) {
      let q = str;
      if (/[a-zA-Z]/.test(q)) {
        q = q.replace(/[\u10D0-\u10FF]+/g, '').trim();
      }
      return q;
    }

    function extractGeorgianTitle(str) {
      const geo = str.match(/[\u10D0-\u10FF\s]+/g);
      return geo ? geo.join(' ').replace(/\s+/g, ' ').trim() : str;
    }

    function normTitle(s) {
      return (s || "")
        .toLowerCase()
        .replace(/[\s_]+/g, " ")
        .replace(/[^0-9a-z\u0400-\u04FF\u10A0-\u10FF ]+/gi, "")
        .trim();
    }

    function tokens(s) {
      return normTitle(s)
        .split(" ")
        .filter((w) => w && w.length >= 2);
    }

    function scoreTitle(q, t) {
      if (!q || !t) return 0;
      // Bonus: if the normalized query appears verbatim in the target
      const nq = normTitle(q);
      const nt = normTitle(t);
      if (nt === nq) return 1.5; // exact match — highest priority
      if (nt.includes(nq)) return 1.2; // query fully contained in target
      const qt = tokens(q);
      const pt = tokens(t);
      if (!qt.length || !pt.length) return 0;
      let h = 0;
      qt.forEach((w) => {
        if (pt.indexOf(w) > -1) h++;
      });
      return h / qt.length;
    }

    function extractYearFromStr(s) {
      const m = String(s || "").match(/\b(19|20)\d{2}\b/);
      return m ? m[0] : "";
    }

    function extractYearFromUrl(u) {
      try {
        const p = new URL(u).pathname;
        const m = p.match(/(?:-|\/)((?:19|20)\d{2})(?:-|\/|\.html)/);
        return m ? m[1] : "";
      } catch {
        return "";
      }
    }

    /* ================= resolvers ================= */

    async function csstResolve(embedUrl) {
      try {
        const m = embedUrl.match(/\/embed\/(\d+)\/?/);
        if (!m) throw 0;
        const id = m[1];
        const resp = await fetch(`https://csst.online/api/source/${id}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json;charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Referer: "https://csst.online/",
            Origin: "https://csst.online",
          },
          body: JSON.stringify({ r: embedUrl, d: "csst.online" }),
          redirect: "follow",
        });
        const txt = await resp.text();
        try {
          const j = JSON.parse(txt);
          if (Array.isArray(j.data) && j.data.length)
            return { data: normalizeAndSort(j.data) };
        } catch { /* response was HTML rather than JSON; HTML fallback follows */ }
      } catch { /* API endpoint unavailable; HTML fallback follows */ }
      const html = await getText(embedUrl, "https://csst.online/");
      const list = normalizeAndSort(
        extractMediaLinks(html)
          .concat(extractMediaLinks(decodeBase64Blobs(html)))
          .map((u) => ({
            file: u,
            label: /\.m3u8/i.test(u) ? "HLS" : "auto",
          }))
      );
      return { data: list };
    }

    async function vkResolve(embedUrl) {
      const html = (await getText(embedUrl, "https://vkvideo.ru/")).replace(
        /\\\//g,
        "/"
      );
      const q = {};
      let m;
      const re = /"url(\d{3,4})"\s*:\s*"([^"]+)"/gi;
      while ((m = re.exec(html)) !== null) q[m[1] + "p"] = m[2];
      const out = [];
      ["1080p", "720p", "480p", "360p"].forEach((k) => {
        if (q[k]) out.push({ file: q[k], label: k });
      });
      const direct = extractMediaLinks(html);
      direct.forEach((u) => {
        if (!/\.m3u8/i.test(u)) out.unshift({ file: u, label: "auto" });
      });
      return { data: normalizeAndSort(out) };
    }

    async function okResolve(embedUrl) {
      const html = await getText(embedUrl, "https://ok.ru/");
      const fixed = html.replace(/\\\//g, "/").replace(/\\u0026/g, "&");

      // 1) HLS manifest
      const m2 = fixed.match(
        /"(?:manifest|m3u8|hlsManifestUrl|hlsMasterPlaylistUrl)"\s*:\s*"([^"]+\.m3u8[^"]*)"/i
      );
      if (m2 && m2[1]) {
        const u = m2[1];
        return { data: normalizeAndSort([{ file: u, label: "HLS" }]) };
      }

      // 2) videos[] JSON (mobile/lowest/low/sd/hd ...)
      const vids = [];
      const vBlock = fixed.match(/"videos"\s*:\s*\[(.+?)\]/is);
      if (vBlock && vBlock[1]) {
        const raw = "[" + vBlock[1] + "]";
        try {
          const arr = JSON.parse(raw.replace(/(\w+)\s*:/g, '"$1":'));
          arr.forEach((v) => {
            if (v && v.url) {
              vids.push({
                file: String(v.url),
                label: (v.name || "auto").toString().toLowerCase(),
              });
            }
          });
        } catch { /* one malformed video entry must not hide the remaining entries */ }
      }
      if (vids.length) return { data: normalizeAndSort(vids) };

      // 3) fallback ბმულები
      const links = normalizeAndSort(
        extractMediaLinks(fixed).map((u) => ({
          file: u,
          label: /\.m3u8/i.test(u) ? "HLS" : "auto",
        }))
      );
      if (links.length) return { data: links };

      // 4) ზოგადი URL-ებიც ვცადოთ (okcdn.ru/?type=3 ...)
      const gen = extractGenericVideoUrls(fixed).map((u) => ({
        file: u,
        label: "auto",
      }));
      return { data: normalizeAndSort(gen) };
    }

    async function secvideoResolve(embedUrl) {
      const html = await getText(embedUrl, embedUrl);
      const fixed = html.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
      const combo = [];
      {
        const re =
          /file\s*:\s*["']([^"']*?(?:\[(?:\d{3,4}p|auto)\][^"']+?)(?:\s*,\s*\[(?:\d{3,4}p|auto)\][^"']+?)+[^"']*)["']/i;
        const m = re.exec(fixed);
        if (m) combo.push({ file: m[1], label: "" });
      }
      if (combo.length) return { data: normalizeAndSort(combo) };

      const links = extractMediaLinks(fixed);
      if (links.length)
        return {
          data: normalizeAndSort(
            links.map((u) => ({
              file: u,
              label: /\.m3u8/i.test(u) ? "HLS" : "auto",
            }))
          ),
        };

      const alt = [];
      {
        const re =
          /"(https?:\/\/[^"]+?\.mp4[^"]*)"\s*,\s*"(?:\d{3,4}p|auto)"/gi;
        let m;
        while ((m = re.exec(fixed)) !== null) alt.push({ file: m[1], label: "auto" });
      }
      if (alt.length) return { data: normalizeAndSort(alt) };
      return { data: [] };
    }

    async function sibnetResolve(embedUrl) {
      const html = await getText(embedUrl, "https://video.sibnet.ru/");
      const links = extractMediaLinks(html);
      if (links.length)
        return {
          data: normalizeAndSort(
            links.map((u) => ({
              file: u,
              label: /\.m3u8/i.test(u) ? "HLS" : "auto",
            }))
          ),
        };
      return { data: [{ file: embedUrl, label: "auto" }] };
    }

    // animeb.ge resolver — extracts iframe src and resolves the embedded video URL
    async function animebResolve(pageUrl) {
      // Fetch the page HTML
      const html = await getText(pageUrl, pageUrl);
      // Find the first iframe src attribute
      const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeMatch && iframeMatch[1]) {
        // Resolve relative URLs against the page URL
        const embedUrl = abs(pageUrl, iframeMatch[1]);
        // Delegate to resolveCandidate to handle the actual video embed (e.g., sibnet, csst, etc.)
        return await resolveCandidate(embedUrl);
      }
      return { data: [] };
    }

    // my.mail.ru / videoapi.my.mail.ru — გაძლიერებული resolver (პირდაპირ iframe-იდან)
    async function mailruResolve(embedUrl) {
      const ref = 'https://my.mail.ru/';
      const html = await getText(embedUrl, ref);
      const fixed = html.replace(/\\\//g, '/').replace(/\\u0026/g, '&');

      // მყისიერი HLS (იშვიათია, მაგრამ დავტოვოთ)
      const m3 = fixed.match(/"(?:manifest|m3u8|hlsManifestUrl|hlsMasterPlaylistUrl)"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
      if (m3 && m3[1]) return { data: normalizeAndSort([{ file: m3[1], label: 'HLS' }]) };

      let collected = [];

      // metadataUrl в†’ videos[]
      const md = fixed.match(/"metadataUrl"\s*:\s*"([^"]+)"/i);
      if (md && md[1]) {
        const mdUrl = md[1];
        const metaTxt = await getText(mdUrl, ref);
        try {
          const j = JSON.parse(metaTxt);
          if (Array.isArray(j.videos)) {
            j.videos.forEach(v => {
              if (v && v.url) {
                const u = String(v.url).replace(/^\/\//, 'https://');
                const lab = (/\.m3u8/i.test(u) ? 'HLS' : (v.quality || v.key ? String(v.quality || v.key).toLowerCase() : 'auto'));
                collected.push({ file: u, label: lab });
              }
            });
          }
          extractMediaLinks(metaTxt).forEach(u => collected.push({ file: u, label: /\.m3u8/i.test(u) ? 'HLS' : 'auto' }));
        } catch (_) {
          extractMediaLinks(metaTxt).forEach(u => collected.push({ file: u, label: /\.m3u8/i.test(u) ? 'HLS' : 'auto' }));
        }
      }

      // embed გვერდიდანაც ამოიკრიფოს MP4/HLS.
      extractMediaLinks(fixed).forEach(u => collected.push({ file: u, label: /\.m3u8/i.test(u) ? 'HLS' : 'auto' }));

      // ზოგადი ვიდეო URL-ებიც (MP4 query-ებით)
      extractGenericVideoUrls(fixed).forEach(u => collected.push({ file: u, label: 'auto' }));

      return { data: normalizeAndSort(collected) };
    }

    async function stormoResolve(embedUrl) {
      const html = await getText(embedUrl, embedUrl);
      const fixed = html.replace(/\\\//g, "/");
      const links = extractMediaLinks(fixed).concat(
        extractMediaLinks(decodeBase64Blobs(fixed))
      );
      if (links.length)
        return {
          data: normalizeAndSort(
            links.map((u) => ({
              file: u,
              label: /\.m3u8/i.test(u) ? "HLS" : "auto",
            }))
          ),
        };
      return { data: [] };
    }

    async function myviResolve(embedUrl) {
      const html = await getText(embedUrl, "https://myvi.ru/");
      const fixed = html.replace(/\\\//g, "/");
      const links = extractMediaLinks(fixed).concat(
        extractMediaLinks(decodeBase64Blobs(fixed))
      );
      if (links.length)
        return {
          data: normalizeAndSort(
            links.map((u) => ({
              file: u,
              label: /\.m3u8/i.test(u) ? "HLS" : "auto",
            }))
          ),
        };
      return { data: [] };
    }

    async function resolveCandidate(u, ref) {
      try {
        if (/\.(mp4|m3u8)(\/|\?|$)/i.test(u)) {
          return { data: [{ file: u, label: /\.m3u8/i.test(u) ? "HLS" : "auto" }] };
        }

        if (/csst\.online\/embed\//i.test(u)) return await csstResolve(u);
        if (/vkvideo\.ru\/video_ext\.php/i.test(u)) return await vkResolve(u);
        if (/ok\.ru\/videoembed\//i.test(u)) return await okResolve(u);
        if (/secvideo\d*\.online\/embed\//i.test(u))
          return await secvideoResolve(u);
        if (/video\.sibnet\.ru\/shell\.php/i.test(u))
          return await sibnetResolve(u);
        if (/animeb\.ge/.test(u))
          return await animebResolve(u);
        if (
          /videoapi\.my\.mail\.ru\/videos\/embed\/|my\.mail\.ru\/.+\/video\/embed\//i.test(
            u
          )
        )
          return await mailruResolve(u);
        if (/stormo\.online\/embed\//i.test(u)) return await stormoResolve(u);
        if (/myvi\.ru\/player\/embed\/html\//i.test(u))
          return await myviResolve(u);

        const html = await getText(u, ref || u);
        let found = extractMediaLinks(html);
        if (!found.length) found = extractMediaLinks(decodeBase64Blobs(html));
        if (!found.length) {
          const gen = extractGenericVideoUrls(html);
          if (gen.length) {
            return { data: normalizeAndSort(gen.map(f => ({ file: f, label: 'auto' }))) };
          }
          // If no media found, return the url itself and flag it as an iframe
          return { data: [{ file: u, label: "iframe fallback", isIframe: true, rawUrl: u }] };
        }
        return {
          data: normalizeAndSort(
            found.map((f) => ({
              file: f,
              label: /\.m3u8/i.test(f) ? "HLS" : "auto",
            }))
          ),
        };
      } catch {
        return { data: [] };
      }
    }

    async function searchUfasofilmebi(query, type, engQuery) {
      try {
        const searchQuery = engQuery || query;
        const searchUrl = 'https://ufasofilmebi.ge/?s=' + encodeURIComponent(searchQuery);
        const r = await fetchProvider(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }, { timeoutMs: 10_000 });
        const html = await r.text();
        
        const links = [...html.matchAll(/href=["'](https?:\/\/ufasofilmebi\.ge)?(\/[^"\'\s/]+\/)["']/gi)];
        
        const results = links.map(m => {
           let url = m[2];
           if (!url.startsWith('http')) url = 'https://ufasofilmebi.ge' + url;
           const slug = url.split('/').filter(Boolean).pop() || '';
           const title = decodeURIComponent(slug).replace(/-/g, ' ');
           return { url, title };
        }).filter(m => {
           if (m.url.includes('/genre/')) return false;
           if (m.url.includes('/country/')) return false;
           if (m.url.includes('/year/')) return false;
           if (m.url.includes('/actor/')) return false;
           if (m.url.includes('/director/')) return false;
           if (m.url.includes('/wp-content/')) return false;
           if (m.url.includes('/page/')) return false;
           if (m.title.length < 2) return false;
           return true;
        });

        const uniqueResults = [];
        const seenUrls = new Set();
        for (const res of results) {
            if (!seenUrls.has(res.url)) {
                seenUrls.add(res.url);
                uniqueResults.push(res);
            }
        }

        let bestScore = 0;
        let bestMatch = null;
        for (const res of uniqueResults) {
           let score = Math.max(scoreTitle(query, res.title), engQuery ? scoreTitle(engQuery, res.title) : 0);
           if (score > bestScore) {
             bestScore = score;
             bestMatch = res;
           }
        }

        if (bestMatch && bestScore > 0.2) {
          const detailR = await fetchProvider(bestMatch.url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, { timeoutMs: 10_000 });
          const detailHtml = await detailR.text();
          
          if (type === 'movie') {
              const serversMatch = detailHtml.match(/var\s+Servers\s*=\s*(\{[\s\S]*?\});/);
              if (serversMatch) {
                  try {
                      const servers = JSON.parse(serversMatch[1]);
                      let embedUrl = servers.superembed || servers.premium;
                      if (embedUrl) {
                          if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
                          return [{ file: embedUrl, label: "ufasofilmebi.ge", source: "ufasofilmebi.ge" }];
                      }
                  } catch (error) {
                    console.error(JSON.stringify({ message: 'provider_payload_invalid', provider: 'ufasofilmebi.ge', section: 'servers', error: error instanceof Error ? error.message : String(error) }));
                  }
              }
          } else if (type === 'series') {
              const linksMatch = detailHtml.match(/var\s+links\s*=\s*(\{[\s\S]*?\});/);
              if (linksMatch) {
                  try {
                      const lData = JSON.parse(linksMatch[1]);
                      const seasonMap = {};
                      for (const [key, val] of Object.entries(lData)) {
                          const m = key.match(/s(\d+)_(\d+)/i);
                          if (m && val.data && val.data.length && val.data[0]["1"] && val.data[0]["1"].url) {
                              let sNum = parseInt(m[1]);
                              let eNum = parseInt(m[2]);
                              if (!seasonMap[sNum]) seasonMap[sNum] = [];
                              seasonMap[sNum].push({ episode: eNum, title: `S${sNum} E${eNum}`, url: val.data[0]["1"].url });
                          }
                      }
                      const seasons = [];
                      for (const [sNum, eps] of Object.entries(seasonMap)) {
                          seasons.push({ season: parseInt(sNum), episodes: eps });
                      }
                      return seasons;
                  } catch (error) {
                    console.error(JSON.stringify({ message: 'provider_payload_invalid', provider: 'ufasofilmebi.ge', section: 'episodes', error: error instanceof Error ? error.message : String(error) }));
                  }
              }
          }
        }
      } catch (e) {
        console.error("ufasofilmebi.ge search error:", e);
      }
      return [];
    }

    async function searchChemikino(query, type, engQuery) {
      try {
        const searchQuery = engQuery || query;
        const searchUrl = 'https://chemikino.com/index.php?do=search';
        const bodyText = 'do=search&subaction=search&story=' + encodeURIComponent(searchQuery);
        const r = await fetchProvider(searchUrl, {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: bodyText
        }, { timeoutMs: 10_000 });
        const html = await r.text();
        
        const links = [...html.matchAll(/href=["'](https?:\/\/chemikino\.com)?(\/\d+-[^"']+\.html)["']/gi)];
        
        const results = links.map(m => {
           let url = m[2];
           if (!url.startsWith('http')) url = 'https://chemikino.com' + url;
           const slug = url.split('/').filter(Boolean).pop() || '';
           const cleanSlug = slug.replace(/^\d+-/, '').replace('.html', '');
           const title = cleanSlug.replace(/-/g, ' ');
           return { url, title };
        });

        const uniqueResults = [];
        const seenUrls = new Set();
        for (const res of results) {
            if (!seenUrls.has(res.url)) {
                seenUrls.add(res.url);
                uniqueResults.push(res);
            }
        }

        let bestMatch = null;
        let bestScore = -1;
        for (const m of uniqueResults) {
          const score = Math.max(scoreTitle(query, m.title), engQuery ? scoreTitle(engQuery, m.title) : 0);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = m;
          }
        }

        if (bestMatch && bestScore > 0.2) {
          const pageHtml = await getText(bestMatch.url, 'https://chemikino.com/');
          const frames = [];
          const reI = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
          let match;
          while ((match = reI.exec(pageHtml)) !== null) {
             let frameUrl = match[1];
             if (frameUrl.startsWith('//')) frameUrl = 'https:' + frameUrl;
             if (frameUrl.includes('vidsrc')) continue; // Block vidsrc!
             if (frameUrl.includes('vidsrc')) continue; // Block vidsrc!
             if (!frameUrl.includes('google-analytics') && !frameUrl.includes('googletagmanager') && !frameUrl.includes('a-ads.com')) {
                frames.push(frameUrl);
             }
          }
          
          const streams = [];
          for (const f of frames) {
            const resolved = await resolveCandidate(f, bestMatch.url);
            if (resolved.data && resolved.data.length) {
              streams.push(...resolved.data);
            }
          }
          
          if (streams.length) {
             return wrapStreams(streams, bestMatch.url);
          }
        }
      } catch (e) {
        console.error("chemikino search error:", e);
      }
      return [];
    }

    async function searchCroconet(query, type, season, episode, engQuery) {
      try {
        const searchQuery = engQuery || query;
        const searchUrl = 'https://croconet.cam/search/' + encodeURIComponent(searchQuery);
        const r = await fetchProvider(searchUrl, { headers: htmlHeaders() }, { timeoutMs: 10_000 });
        const html = await r.text();
        const links = [...html.matchAll(/href=["'](https?:\/\/croconet\.cam)?(\/(?:movie|show|series|serial)\/\d+\/[^"']+)["']/gi)];
        
        const results = links.map(m => {
           let url = m[2];
           if (!url.startsWith('http')) url = 'https://croconet.cam' + url;
           const parts = url.split('/').filter(Boolean);
           const slug = parts[parts.length - 1] || '';
           const title = slug.replace(/-/g, ' ');
           return { url, title };
        }).filter(m => {
           if (m.url.includes('/category/')) return false;
           if (m.url.includes('/genre/')) return false;
           if (m.title.length < 2) return false;
           return true;
        });

        const uniqueResults = [];
        const seenUrls = new Set();
        for (const res of results) {
            if (!seenUrls.has(res.url)) {
                seenUrls.add(res.url);
                uniqueResults.push(res);
            }
        }

        let bestMatch = null;
        let bestScore = -1;
        for (const m of uniqueResults) {
          const score = Math.max(scoreTitle(query, m.title), engQuery ? scoreTitle(engQuery, m.title) : 0);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = m;
          }
        }

        if (bestMatch && bestScore > 0.2) {
          const detailHtml = await getText(bestMatch.url, 'https://croconet.cam/');
          const m3u8Regex = /https?:[^\s"'`,]+?\.m3u8/gi;
          const matches = [...detailHtml.matchAll(m3u8Regex)].map(x => x[0]);
          
          const cleanLinks = matches.map(m => {
              return m.replace(/\\+/g, '/').replace(/\/+/g, '/').replace(':/', '://');
          }).filter(l => !l.includes('treiler') && !l.includes('trailer'));
          
          const uniqueLinks = [...new Set(cleanLinks)];
          
          if (type === 'series' && season !== undefined && episode !== undefined) {
             const matched = uniqueLinks.find(l => l.includes(`/${season}_${episode}/`) || l.includes(`/${season}-${episode}/`));
             if (matched) {
                return [{ file: matched, label: "Croconet.cam", rawUrl: matched, isIframe: false }];
             }
             if (uniqueLinks.length) {
                const epLink = uniqueLinks.find(l => l.includes(`/${season}_`) || l.includes(`/series/`));
                if (epLink) return [{ file: epLink, label: "Croconet.cam", rawUrl: epLink, isIframe: false }];
             }
          } else {
             if (uniqueLinks.length) {
                return [{ file: uniqueLinks[0], label: "Croconet.cam", rawUrl: uniqueLinks[0], isIframe: false }];
             }
          }
        }
      } catch (e) {
        console.error("Croconet search error:", e);
      }
      return [];
    }

    async function searchAdjaranetto(q) {
      try {
        const doSearch = async (query) => {
          const r = await fetchProvider("https://adjaranetto.com/search?q=" + encodeURIComponent(query), {
            headers: htmlHeaders()
          }, { timeoutMs: 10_000 });
          const html = await r.text();
          const scripts = [...html.matchAll(/<script>self\.__next_f.*?<\/script>/gs)];
          if (!scripts.length) return [];

          const allData = scripts.map(s => s[0]).join('');
          const movies = [];
          const seen = new Set();

          // Structure in escaped Next.js JSON: \"id\":10792,\"title\":\"ბუნკერი | SILO\",\"title_ka\":\"...\",\"title_en\":null,\"slug\":\"bunkeri-ji\",\"year\":2023
          const pattern = /\\"id\\":\d+,\\"title\\":\\"([^"]+?)\\",\\"title_ka\\":\\"([^"]*?)\\"(?:,\\"title_en\\":(?:null|\\"[^"]*?\\"))?,\\"slug\\":\\"([^"]+?)\\",\\"year\\":(\d+|null)/g;
          const matches = [...allData.matchAll(pattern)];

          for (const m of matches) {
            const titleEn = m[1];
            const titleKa = m[2];
            const slug = m[3];
            const year = parseInt(m[4]);
            if (!seen.has(slug)) {
              seen.add(slug);
              const allTitles = [titleEn, titleKa].filter(Boolean).join(' ');
              movies.push({ slug, title: titleEn || titleKa, year, allTitles });
            } else {
              const existing = movies.find(x => x.slug === slug);
              if (existing && !existing.allTitles.includes(titleEn || titleKa)) {
                existing.allTitles += " " + (titleEn || titleKa);
              }
            }
          }
          return movies;
        };

        // First try full query
        let results = await doSearch(q);

        // If no results and query is multi-word English, try the longest keyword
        if (!results.length && /^[a-zA-Z0-9\s]+$/.test(q)) {
          const words = q.split(/\s+/).filter(w => w.length > 3);
          if (words.length > 1) {
            const longestWord = words.reduce((a, b) => b.length > a.length ? b : a, '');
            if (longestWord !== q) {
              results = await doSearch(longestWord);
            }
          }
        }

        return results;
      } catch (e) {
        return [];
      }
    }

    async function getAdjaranettoMovieUrl(slug) {
      try {
        const url = "https://adjaranetto.com/" + slug + ".html";
        const r = await fetchProvider(url, { headers: htmlHeaders() }, { timeoutMs: 10_000 });
        const html = await r.text();

        const nextFData = [...html.matchAll(/<script>self\.__next_f.*?<\/script>/g)].join('');
        const matches = [...nextFData.matchAll(/\\"url\\":\\"?([^"\\]+)\\"?/g)];
        const validUrls = matches.map(m => m[1]).filter(u => /(sibnet\.ru|incvideo|secvideo|csst\.online|vkvideo|myvi|mykadri\.vip|embed|\.mp4|\.m3u8)/i.test(u));
        if (validUrls.length) return validUrls[0];
      } catch (error) {
        console.error(JSON.stringify({ message: 'provider_detail_failed', provider: 'adjaranetto.com', error: error instanceof Error ? error.message : String(error) }));
      }
      return null;
    }

    // Resolve packed-JS video players (adjaraneti.xyz, mykadri.vip, and similar)
    async function resolvePackedPlayer(url) {
      try {
        const domain = new URL(url).hostname; // e.g. adjaraneti.xyz or mykadri.vip
        const res = await fetchProvider(url, {
          headers: { ...htmlHeaders(), 'Referer': 'https://adjaranetto.com/' }
        }, { timeoutMs: 10_000 });
        const html = await res.text();
        const idx = html.indexOf('eval(function(p,a,c,k,e,d)');
        if (idx < 0) return null;
        let depth = 0;
        let i = idx + 4;
        while (i < html.length) {
          if (html[i] === '(') depth++;
          else if (html[i] === ')') { depth--; if (depth === 0) { i++; break; } }
          i++;
        }
        const packedExpr = html.substring(idx + 4, i);
        // Custom unpacker to avoid eval() which throws in Cloudflare Workers
        const argsMatch = packedExpr.match(/}\s*\(\s*(['"])(.*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])(.*?)\5\.split\(['"]\|['"]\)/);
        let decoded = "";
        if (argsMatch) {
            let p = argsMatch[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            const a = parseInt(argsMatch[3]);
            const c = parseInt(argsMatch[4]);
            const k = argsMatch[6].split('|');
            const e = function (c) {
                return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
            };
            decoded = p;
            for (let j = c - 1; j >= 0; j--) {
                if (k[j]) {
                    const re = new RegExp('\\b' + e(j) + '\\b', 'g');
                    decoded = decoded.replace(re, k[j]);
                }
            }
        } else {
            console.error(JSON.stringify({ message: 'packed_player_format_changed', provider: domain }));
            return null;
        }
        // Extract stream URLs from decoded JS
        const hls4m = decoded.match(/"hls4"\s*:\s*"(\/[^"]+\.m3u8[^"]*)"/); // relative path
        const hls2m = decoded.match(/"hls2"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/); // absolute
        const hls3m = decoded.match(/"hls3"\s*:\s*"(https?:\/\/[^"]+)"/); // external CDN
        const mp4m = decoded.match(/"mp4"\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/); // mp4
        if (hls4m) return 'https://' + domain + hls4m[1];
        if (hls2m) return hls2m[1];
        if (mp4m) return mp4m[1];
        if (hls3m) return hls3m[1];
      } catch (error) {
        console.error(JSON.stringify({ message: 'packed_player_failed', error: error instanceof Error ? error.message : String(error) }));
      }
      return null;
    }

    async function getAdjaranettoSeriesEpisodes(slug) {
      try {
        const url = "https://adjaranetto.com/" + slug + ".html";
        const r = await fetchProvider(url, { headers: htmlHeaders() }, { timeoutMs: 10_000 });
        const html = await r.text();
        const scripts = [...html.matchAll(/<script>self\.__next_f.*?<\/script>/gs)];
        const allData = scripts.map(s => s[0]).join('');

        // Real structure in Next.js RSC (triple-escaped):
        // \"season_id\":69577,\"episode_number\":1,\"title\":\"სერია 1\",\"url\":\"https://video.sibnet.ru/...\"

        // Extract season mappings
        const seasonMatches = [...allData.matchAll(/\\"id\\":(\d+),\\"movie_id\\":\d+,\\"season_number\\":(\d+)/g)];
        const seasons = {};
        for (const m of seasonMatches) {
          if (!seasons[m[1]]) {
            seasons[m[1]] = { season: parseInt(m[2]), episodes: [] };
          }
        }

        // Extract episodes - try to get csst.online URL from players array
        const episodePattern = /\\"season_id\\":(\d+),\\"episode_number\\":(\d+),\\"title\\":\\"([^"]+?)\\",\\"url\\":\\"([^"]*?)\\"(?:[^}]*?\\"players\\":\[([^\]]{0,2000})\])?/g;
        const episodeMatches = [...allData.matchAll(episodePattern)];

        for (const m of episodeMatches) {
          const sId = m[1];
          const epNum = parseInt(m[2]);
          const epTitle = m[3];
          const epUrl = m[4];
          const playersStr = m[5] || '';

          if (seasons[sId]) {
            // Extract all player URLs from the players JSON blob
            const allPlayerUrls = [...playersStr.matchAll(/\\"url\\":\\"([^"]+?)\\"/g)].map(p => p[1]);
            // Prefer csst.online or incvideo or mykadri.vip direct link
            const bestUrl = allPlayerUrls.find(u => /csst\.online/i.test(u))
              || allPlayerUrls.find(u => /mykadri\.vip/i.test(u))
              || allPlayerUrls.find(u => /incvideo/i.test(u))
              || epUrl;

            // Avoid duplicate episodes
            if (!seasons[sId].episodes.find(e => e.episode === epNum)) {
              seasons[sId].episodes.push({ episode: epNum, title: epTitle, url: bestUrl });
            }
          }
        }

        return Object.values(seasons).sort((a, b) => a.season - b.season);
      } catch (e) {
        return [];
      }
    }

    /* ================= search on imovs ================= */
    function pickMovieLinksFromSearch(html, baseUrl) {
      const out = new Set();
      const rePrimary =
        /<a[^>]+class=["'][^"']*(?:text-truncate|post-title|card-title)[^"']*["'][^>]+href=["']([^"']+\.html(?:\?[^"']*)?)["'][^>]*>/gi;
      let m;
      while ((m = rePrimary.exec(html)) !== null) {
        const u = abs(baseUrl, m[1]);
        try {
          if (/\.html$/i.test(new URL(u).pathname)) out.add(u);
        } catch { /* discard malformed candidate URLs */ }
      }
      if (!out.size) {
        const reAll =
          /<a[^>]+href=["']([^"']+\.html(?:\?[^"']*)?)["'][^>]*>/gi;
        while ((m = reAll.exec(html)) !== null) {
          const u = abs(baseUrl, m[1]);
          try {
            const p = new URL(u).pathname || "/";
            if (
              /\.html$/i.test(p) &&
              !/(?:\/|^)(?:page|category|cats|genres|serialebi|news)(?:\/|$)/i.test(
                p
              )
            )
              out.add(u);
          } catch { /* discard malformed candidate URLs */ }
        }
      }
      return Array.from(out);
    }

    async function strongSearch(q) {
      try {
        const form = new URLSearchParams();
        form.set("do", "search");
        form.set("subaction", "search");
        form.set("story", q);
        const r = await fetchProvider("https://www.imovs.ge/index.php?do=search", {
          method: "POST",
          body: form,
          redirect: "follow",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: "https://www.imovs.ge/",
            Origin: "https://www.imovs.ge",
            "User-Agent": htmlHeaders().get("User-Agent"),
          },
          cf: { cacheTtl: 0, cacheEverything: false },
        }, { timeoutMs: 10_000 });
        const t = await r.text();
        if (t && !looksLikeCF(t))
          return { base: "https://www.imovs.ge", html: t };
      } catch (error) {
        console.error(JSON.stringify({ message: 'provider_search_failed', provider: 'imovs.ge', stage: 'post', error: error instanceof Error ? error.message : String(error) }));
      }
      const BASES = ["https://www.imovs.ge", "https://imovs.ge"];
      const paths = [
        (x) => `/?do=search&subaction=search&story=${encodeURIComponent(x)}`,
        (x) =>
          `/?do=search&subaction=search&search_start=0&full_search=0&story=${encodeURIComponent(
            x
          )}`,
        (x) =>
          `/index.php?do=search&subaction=search&story=${encodeURIComponent(x)}`,
      ];
      for (const B of BASES)
        for (const make of paths) {
          const u = B + make(q);
          const t = await getText(u, B + "/");
          if (t && !looksLikeCF(t)) return { base: B, html: t };
        }
      return { base: "", html: "" };
    }

    async function chooseBestDetail(candidates, query) {
      const wantYear = extractYearFromStr(query);
      let best = { url: "", score: -1, page: "" };

      for (let i = 0; i < candidates.length && i < 15; i++) {
        const u = candidates[i];
        const page = await getText(u, u);
        const ttl = pickTitle(page) || u;

        const tScore = scoreTitle(query, ttl);
        const yPage = extractYearFromStr(ttl) || extractYearFromUrl(u);
        const yHit = wantYear && yPage ? (wantYear === yPage ? 1 : 0) : wantYear ? 0 : 0.5;

        let cScore = 0;
        const iframes = (page.match(/<iframe[^>]+src=["'][^"']+["']/gi) || []).length;
        if (iframes >= 1) cScore += 0.2;
        if (/(jwp-iframe|player-tabs__container|data-player|data-url|data-src)/i.test(page)) cScore += 0.1;

        const total = tScore * 0.6 + yHit * 0.25 + cScore * 0.15;
        if (total > best.score) best = { url: u, score: total, page };
      }

      const minScore = wantYear ? 0.35 : 0.28;
      if (best.score < minScore) return { url: "", page: "" };
      return best;
    }

    function wrapStreams(list, referer) {
      return (list || []).map((x) => {
        if (x.isIframe) return x; // DON'T WRAP IFRAMES!
        const f = x.file;
        const streamReferer = x.referer || referer || "https://csst.online/embed/";
        if (/\.m3u8(?:\?|$)/i.test(f)) {
          return {
            ...x,
            file: `${SELF}/hls?u=${encodeURIComponent(f)}&ref=${encodeURIComponent(
              streamReferer
            )}`,
            label: x.label || "HLS",
          };
        }
        // ყველა დანარჩენი ვიდეო URL გადის /play-ზე (თუნდაც გაფართოება არ ეწეროს).
        return {
          ...x,
          file: `${SELF}/play?u=${encodeURIComponent(f)}&ref=${encodeURIComponent(
            streamReferer
          )}`,
          label: x.label || "auto",
        };
      });
    }

    /* ================= ROUTES ================= */

    // MOVIE
    if (url.pathname === "/imovs") {
      const q = (url.searchParams.get("q") || "").trim();
      const dbg = url.searchParams.get("debug") === "1";
      const source = url.searchParams.get("source");
      if (!q) return json({ ok: false, error: "Missing q" });

      const wantYear = extractYearFromStr(q);
      let allPlayers = [];

      let cleanQ = wantYear ? q.replace(new RegExp('\\b' + wantYear + '\\b'), '').trim() : q;
      cleanQ = cleanQ
        .replace(/:\s*სეზონი\s*\d+/gi, '')
        .replace(/\s*სეზონი\s*\d+/gi, '')
        .replace(/:\s*season\s*\d+/gi, '')
        .replace(/\s*season\s*\d+/gi, '')
        .replace(/:\s*s\d+/gi, '')
        .replace(/\s*s\d+/gi, '')
        .replace(/\s*სეზონი/gi, '')
        .replace(/\s*season/gi, '')
        .trim();

      const qEng = (url.searchParams.get('eng') || '').trim() || extractEnglishTitle(cleanQ);
      const qGeo = extractGeorgianTitle(cleanQ);

      const customTitleMap = {
        "from": "გარედან",
        "silo": "ბუნკერი",
        "see": "ხილვა",
        "lost": "დაკარგულები",
        "fargo": "ფარგო",
        "breaking bad": "მძიმე დანაშაული",
        "fallout": "ფოლაუტი"
      };

      // 1. Try Adjaranetto
      if (!source || source === 'adjaranetto.com') {
        let adjaMovies = [];
        const mappedTitle = customTitleMap[cleanQ.toLowerCase()];
        if (mappedTitle) {
          adjaMovies = adjaMovies.concat(await searchAdjaranetto(mappedTitle));
        }
        if (qGeo && qGeo.length > 2) {
          adjaMovies = adjaMovies.concat(await searchAdjaranetto(qGeo));
        }
        if (qEng && qEng.length > 2 && qEng !== qGeo) {
          adjaMovies = adjaMovies.concat(await searchAdjaranetto(qEng));
        }
        if (qGeo && qEng && qGeo !== qEng) {
          adjaMovies = adjaMovies.concat(await searchAdjaranetto(`${qGeo} | ${qEng}`));
        }
        if (cleanQ && cleanQ !== qGeo && cleanQ !== qEng && cleanQ !== `${qGeo} | ${qEng}`) {
          adjaMovies = adjaMovies.concat(await searchAdjaranetto(cleanQ));
        }

        const seenSlugs = new Set();
        adjaMovies = adjaMovies.filter(m => { if (seenSlugs.has(m.slug)) return false; seenSlugs.add(m.slug); return true; });

        let bestAdja = null;
        let bestScore = -1;
        for (const m of adjaMovies) {
          const targetTitle = m.allTitles || m.title;
          const tScoreClean = scoreTitle(cleanQ, targetTitle);
          const tScoreEng = scoreTitle(qEng, targetTitle);
          const tScoreGeo = scoreTitle(qGeo, targetTitle);
          const targetEngPart = (targetTitle.match(/[|/]\s*([A-Za-z][^|/]+)$/) || [])[1] || '';
          const tScoreEngPart = targetEngPart ? scoreTitle(qEng || cleanQ, targetEngPart.trim()) : 0;
          const tScore = Math.max(tScoreClean, tScoreEng, tScoreGeo, tScoreEngPart);
          const yHit = wantYear && m.year ? (wantYear === m.year ? 1 : 0) : wantYear ? 0 : 0.5;
          const total = tScore * 0.7 + yHit * 0.3;
          if (total > bestScore) {
            bestScore = total;
            bestAdja = m;
          }
        }

        if (bestAdja && bestScore >= (wantYear ? 0.3 : 0.2)) {
          let u = await getAdjaranettoMovieUrl(bestAdja.slug);
          if (u) {
            allPlayers.push({ streams: [{ file: u, label: "adjaranetto.com", rawUrl: u, isIframe: true }], candidate: u, source: "adjaranetto.com" });
          }
        }
      }

      const season = url.searchParams.get("season") ? parseInt(url.searchParams.get("season")) : undefined;
      const episode = url.searchParams.get("episode") ? parseInt(url.searchParams.get("episode")) : undefined;

      // 2. Try ufasofilmebi.ge
      if (!source || source === 'ufasofilmebi.ge') {
        try {
          const ufasoMovies = await searchUfasofilmebi(cleanQ, "movie", qEng);
          if (ufasoMovies && ufasoMovies.length) {
             allPlayers.push({ streams: ufasoMovies, candidate: ufasoMovies[0].file, source: "ufasofilmebi.ge" });
           }
        } catch (error) {
          console.error(JSON.stringify({ message: 'provider_failed', provider: 'ufasofilmebi.ge', error: error instanceof Error ? error.message : String(error) }));
        }
      }

      // 3. Try chemikino.com
      if (!source || source === 'chemikino.com') {
        try {
          const chemiStreams = await searchChemikino(cleanQ, "movie", qEng);
          if (chemiStreams && chemiStreams.length) {
             allPlayers.push({ streams: chemiStreams, candidate: chemiStreams[0].file, source: "chemikino.com" });
          }
        } catch (error) {
          console.error(JSON.stringify({ message: 'provider_failed', provider: 'chemikino.com', error: error instanceof Error ? error.message : String(error) }));
        }
      }

      // 3.5 Try Croconet.cam
      if (!source || source === 'Croconet.cam') {
        try {
          const crocoStreams = await searchCroconet(cleanQ, "movie", undefined, undefined, qEng);
          if (crocoStreams && crocoStreams.length) {
             const wrappedCroco = wrapStreams(crocoStreams, "https://croconet.cam/");
             allPlayers.push({ streams: wrappedCroco, candidate: wrappedCroco[0].file, source: "Croconet.cam" });
          }
        } catch (error) {
          console.error(JSON.stringify({ message: 'provider_failed', provider: 'Croconet.cam', error: error instanceof Error ? error.message : String(error) }));
        }
      }

      // 4. Generic providers imported from the JARVIS reference implementation.
      const genericProviderIds = ['asia.com.ge', 'geofilms.net', 'kinolab.cc', 'geosaitebi.tv'];
      for (const providerId of genericProviderIds) {
        if (source && source !== providerId) continue;
        try {
          const streams = await searchExternalProvider(providerId, { query: cleanQ, engQuery: qEng, geoQuery: qGeo, type: 'movie' });
          if (streams.length) {
            const wrapped = wrapStreams(streams, `https://${providerId}/`);
            allPlayers.push({ streams: wrapped, candidate: wrapped[0].file, source: providerId });
          }
        } catch (error) {
          console.error(JSON.stringify({ message: 'provider_failed', provider: providerId, error: error instanceof Error ? error.message : String(error) }));
        }
      }

      // 5. Try Imovs.ge
      if ((!source || source === 'imovs.ge') && !allPlayers.length) {
        try {
          const { base, html } = await strongSearch(q);
          if (html) {
            const best = await chooseBestDetail(pickMovieLinksFromSearch(html, base), q);
            if (best.url && best.page) {
              const candidates = [];
              const attrRe = /(?:data-url|data-src|data-href|data-player|href|src)=["']([^"']+)["']/gi;
              let match;
              while ((match = attrRe.exec(best.page)) !== null) {
                let candidate = match[1];
                if (/^[A-Za-z0-9+/=]{20,}$/.test(candidate)) {
                  try { candidate = atob(candidate); } catch { /* not base64 */ }
                }
                candidate = abs(best.url, candidate);
                if (/(?:secvideo|sibnet|csst\.online\/embed|vkvideo|ok\.ru\/videoembed|mail\.ru|stormo|myvi|\.m3u8|\.mp4)/i.test(candidate)) candidates.push(candidate);
              }
              const streams = [];
              for (const candidate of uniq(candidates).slice(0, 8)) {
                const resolved = await resolveCandidate(candidate, best.url);
                streams.push(...(resolved.data || []).map((item) => ({ ...item, referer: candidate })));
              }
              const normalized = wrapStreams(normalizeAndSort(streams), best.url);
              if (normalized.length) allPlayers.push({ streams: normalized, candidate: best.url, source: 'imovs.ge' });
            }
          }
        } catch (error) {
          console.error(JSON.stringify({ message: 'provider_failed', provider: 'imovs.ge', error: error instanceof Error ? error.message : String(error) }));
        }
      }

      if (allPlayers.length) {
        if (source) {
          const matchedPlayer = allPlayers.find(p => p.source === source);
          if (matchedPlayer) {
            return json({
              ok: true,
              data: matchedPlayer.streams,
              players: [matchedPlayer]
            });
          }
        }
        return json({
          ok: true,
          data: allPlayers[0].streams,
          players: allPlayers,
        });
      }

      return json({
        ok: false,
        error: "streams_not_found"
      });
    }
    // ANIMEB (search and get episodes)
    if (url.pathname === "/animeb") {
      const q = url.searchParams.get("q");
      if (!q) return json({ ok: false, error: "missing q" });

      try {
        const u = "https://animeb.ge/?do=search&subaction=search&story=" + encodeURIComponent(q);
        const t = await getText(u, "https://animeb.ge/");

        const linkRe = /<a[^>]+href=["'](https?:\/\/animeb\.ge\/anime\/[^"']+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
        const links = [];
        let m;
        while ((m = linkRe.exec(t)) !== null) {
          const title = `${m[2].replace(/<[^>]+>/g, ' ')} ${decodeURIComponent(m[1].split('/').pop() || '').replace(/[-_]/g, ' ')}`;
          if (!links.some(item => item.url === m[1])) links.push({ url: m[1], title });
        }

        if (!links.length) return json({ ok: false, error: "not_found" });

        const best = links.map(item => ({ ...item, score: titleScore(q, item.title) })).sort((a, b) => b.score - a.score)[0];
        if (!best || best.score < 0.25) return json({ ok: false, error: 'not_found', provider: 'animeb.ge' });
        const bestUrl = best.url;
        const detailHtml = await getText(bestUrl, "https://animeb.ge/");

        const episodes = [];
        const seasonBlockRe = /(\d+):\s*\[(\{[\s\S]*?\}(?:,\s*\{[\s\S]*?\})*)\s*,?\s*\]/g;
        let hasSeasons = false;

        while ((m = seasonBlockRe.exec(detailHtml)) !== null) {
          hasSeasons = true;
          const seasonNum = parseInt(m[1]);
          const block = m[2];
          const epRe2 = /\{["']title["']\s*:\s*["']([^"']+)["']\s*,\s*["']url["']\s*:\s*["']([^"']+)["']\s*\}/g;
          let m2;
          let epIndex = 1;
          while ((m2 = epRe2.exec(block)) !== null) {
            let epUrl = m2[2];
            let isIframe = true;
            let resolvedUrl = epUrl;

            // Just pass through proxy for resolution
            resolvedUrl = `${SELF}/play?u=${encodeURIComponent(epUrl)}&ref=${encodeURIComponent(bestUrl)}`;

            episodes.push({
              season: seasonNum,
              episode: epIndex,
              title: "S" + seasonNum + " / " + m2[1],
              streams: [{ file: resolvedUrl, label: "auto", rawUrl: epUrl, isIframe: isIframe }],
              playerIndex: 1,
              source: "animeb.ge",
              candidate: epUrl,
              pageUrl: bestUrl
            });
            epIndex++;
          }
        }

        if (!hasSeasons) {
          const epRe = /\{["']title["']\s*:\s*["']([^"']+)["']\s*,\s*["']url["']\s*:\s*["']([^"']+)["']\s*\}/g;
          let epIndex = 1;
          while ((m = epRe.exec(detailHtml)) !== null) {
            let epUrl = m[2];
            let isIframe = true;
            let resolvedUrl = `${SELF}/play?u=${encodeURIComponent(epUrl)}&ref=${encodeURIComponent(bestUrl)}`;

            episodes.push({
              season: 1,
              episode: epIndex,
              title: m[1],
              streams: [{ file: resolvedUrl, label: "auto", rawUrl: epUrl, isIframe: isIframe }],
              playerIndex: 1,
              source: "animeb.ge",
              candidate: epUrl,
              pageUrl: bestUrl
            });
            epIndex++;
          }
        }

        return episodes.length
          ? json({ ok: true, episodes, provider: 'animeb.ge' })
          : json({ ok: false, error: 'episodes_not_found', provider: 'animeb.ge' });
      } catch (e) {
        return json({ ok: false, error: e.toString() });
      }
    }

    if (url.pathname === "/animetv_page") {
      const pageUrl = url.searchParams.get("url");
      if (!pageUrl) return json({ ok: false, error: "missing url" });
      try {
        const parsed = new URL(pageUrl);
        if (parsed.protocol !== 'https:' || !/(^|\.)animetv\.ge$/i.test(parsed.hostname)) return json({ ok: false, error: 'invalid_url' }, 400);
      } catch {
        return json({ ok: false, error: 'invalid_url' }, 400);
      }
      try {
        const detailHtml = await getText(pageUrl, "https://animetv.ge/");
        const episodes = buildAnimeTvEpisodes(detailHtml, pageUrl);
        let overview = '';
        const descMatch = detailHtml.match(/<div class="custom-description">([\s\S]*?)<\/div>/);
        if (descMatch) {
            overview = descMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        return episodes.length
          ? json({ ok: true, episodes, overview, provider: 'animetv.ge' })
          : json({ ok: false, error: 'episodes_not_found', overview, provider: 'animetv.ge' });
      } catch (e) {
        return json({ ok: false, error: String(e) });
      }
    }

    // ANIMETV.GE (search and get episodes)
    if (url.pathname === "/animetv") {
      const q = url.searchParams.get("q");
      if (!q) return json({ ok: false, error: "missing q" });

      try {
        const u = "https://animetv.ge/index.php?do=search&subaction=search&story=" + encodeURIComponent(q);
        const t = await getText(u, "https://animetv.ge/");

        const linkRe = /<a[^>]+href=["'](https?:\/\/animetv\.ge\/[^"']+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
        const links = [];
        let m;
        while ((m = linkRe.exec(t)) !== null) {
          const title = `${m[2].replace(/<[^>]+>/g, ' ')} ${decodeURIComponent(m[1].split('/').pop() || '').replace(/[-_]/g, ' ')}`;
          if (!links.some(item => item.url === m[1])) links.push({ url: m[1], title });
        }

        if (!links.length) return json({ ok: false, error: "not_found" });

        const best = links.map(item => ({ ...item, score: titleScore(q, item.title) })).sort((a, b) => b.score - a.score)[0];
        if (!best || best.score < 0.25) return json({ ok: false, error: 'not_found', provider: 'animetv.ge' });
        const detailHtml = await getText(best.url, "https://animetv.ge/");
        const episodes = buildAnimeTvEpisodes(detailHtml, best.url);
        return episodes.length
          ? json({ ok: true, episodes, provider: 'animetv.ge' })
          : json({ ok: false, error: 'episodes_not_found', provider: 'animetv.ge' });
      } catch (e) {
        return json({ ok: false, error: String(e) });
      }
    }

    // SERIES
    if (url.pathname === "/imovs-series") {
      const query = (url.searchParams.get("q") || "").trim();
      const source = url.searchParams.get("source");
      const wantYear = extractYearFromStr(query);
      
      let cleanQ = query.replace(/\s*\(\d{4}\)|\s*\d{4}$/, "").trim();
      cleanQ = cleanQ
        .replace(/:\s*სეზონი\s*\d+/gi, '')
        .replace(/\s*სეზონი\s*\d+/gi, '')
        .replace(/:\s*season\s*\d+/gi, '')
        .replace(/\s*season\s*\d+/gi, '')
        .replace(/:\s*s\d+/gi, '')
        .replace(/\s*s\d+/gi, '')
        .replace(/\s*სეზონი/gi, '')
        .replace(/\s*season/gi, '')
        .trim();

      const qEng = (url.searchParams.get('eng') || '').trim() || extractEnglishTitle(cleanQ);
      const qGeo = extractGeorgianTitle(cleanQ);

      const customTitleMap = {
        "from": "გარედან",
        "silo": "ბუნკერი",
        "see": "ხილვა",
        "lost": "დაკარგულები",
        "fargo": "ფარგო",
        "breaking bad": "მძიმე დანაშაული",
        "fallout": "ფოლაუტი"
      };

      const episodes = [];

      // 1. Try Adjaranetto
      if (!source || source === 'adjaranetto.com') {
        let adjaMovies = [];
        const mappedTitle = customTitleMap[cleanQ.toLowerCase()];
        if (mappedTitle) {
          adjaMovies = adjaMovies.concat(await searchAdjaranetto(mappedTitle));
        }
        if (qGeo && qGeo.length > 2) {
          adjaMovies = adjaMovies.concat(await searchAdjaranetto(qGeo));
        }
        if (qEng && qEng.length > 2 && qEng !== qGeo) {
          adjaMovies = adjaMovies.concat(await searchAdjaranetto(qEng));
        }
        if (qGeo && qEng && qGeo !== qEng) {
          adjaMovies = adjaMovies.concat(await searchAdjaranetto(`${qGeo} | ${qEng}`));
        }
        if (cleanQ && cleanQ !== qGeo && cleanQ !== qEng && cleanQ !== `${qGeo} | ${qEng}`) {
          adjaMovies = adjaMovies.concat(await searchAdjaranetto(cleanQ));
        }
        const seenSlugsAdja = new Set();
        adjaMovies = adjaMovies.filter(m => { if (seenSlugsAdja.has(m.slug)) return false; seenSlugsAdja.add(m.slug); return true; });

        let bestAdja = null;
        let bestScore = -1;
        for (const m of adjaMovies) {
          const targetTitle = m.allTitles || m.title;
          const tScoreClean = scoreTitle(cleanQ, targetTitle);
          const tScoreEng = scoreTitle(qEng, targetTitle);
          const tScoreGeo = scoreTitle(qGeo, targetTitle);
          const targetEngPart = (targetTitle.match(/[|/]\s*([A-Za-z][^|/]+)$/) || [])[1] || '';
          const tScoreEngPart = targetEngPart ? scoreTitle(qEng || cleanQ, targetEngPart.trim()) : 0;
          const tScore = Math.max(tScoreClean, tScoreEng, tScoreGeo, tScoreEngPart);
          const yHit = wantYear && m.year ? (wantYear === m.year ? 1 : 0) : wantYear ? 0 : 0.5;
          const total = tScore * 0.7 + yHit * 0.3;
          if (total > bestScore) {
            bestScore = total;
            bestAdja = m;
          }
        }

        if (bestAdja && bestScore >= (wantYear ? 0.3 : 0.2)) {
          const seasons = await getAdjaranettoSeriesEpisodes(bestAdja.slug);
          for (const s of seasons) {
            for (const e of s.episodes) {
                let streamUrl = e.url;
                episodes.push({
                  season: s.season,
                  episode: e.episode,
                  playerIndex: 1,
                  title: `S${s.season} / ეპიზოდი ${e.episode}`,
                  pageUrl: e.url,
                  candidate: streamUrl,
                  streams: [{ file: streamUrl, label: "adjaranetto.com", rawUrl: streamUrl, isIframe: true }],
                  source: "adjaranetto.com"
                });
              }
          }
        }
      }

      const season = url.searchParams.get("season") ? parseInt(url.searchParams.get("season")) : undefined;
      const episode = url.searchParams.get("episode") ? parseInt(url.searchParams.get("episode")) : undefined;

      // 1.5 Try Croconet.cam
      if (!source || source === 'Croconet.cam') {
        try {
          const crocoStreams = await searchCroconet(cleanQ, "series", season, episode, qEng);
          if (crocoStreams && crocoStreams.length) {
             episodes.push({
               season: season || 1,
               episode: episode || 1,
               playerIndex: 1,
               title: `S${season || 1} / ეპიზოდი ${episode || 1}`,
               pageUrl: crocoStreams[0].file,
               candidate: crocoStreams[0].file,
               streams: crocoStreams,
               source: "Croconet.cam"
             });
          }
        } catch (error) {
          console.error(JSON.stringify({ message: 'provider_failed', provider: 'Croconet.cam', error: error instanceof Error ? error.message : String(error) }));
        }
      }

      // 2. Try ufasofilmebi.ge
      if (!source || source === 'ufasofilmebi.ge') {
        try {
          const ufasoSeries = await searchUfasofilmebi(cleanQ, "series", qEng);
          if (ufasoSeries && ufasoSeries.length) {
            for (const s of ufasoSeries) {
              for (const e of s.episodes) {
                let existingEp = episodes.find(x => x.season === s.season && x.episode === e.episode);
                if (existingEp) {
                   existingEp.streams.push({ file: e.url, label: "ufasofilmebi.ge", rawUrl: e.url, isIframe: true });
                } else {
                   episodes.push({
                     season: s.season,
                     episode: e.episode,
                     playerIndex: 1,
                     title: `S${s.season} / ეპიზოდი ${e.episode}`,
                     pageUrl: e.url,
                     candidate: e.url,
                     streams: [{ file: e.url, label: "ufasofilmebi.ge", rawUrl: e.url, isIframe: true }],
                     source: "ufasofilmebi.ge"
                   });
                }
              }
            }
          }
        } catch (error) {
          console.error(JSON.stringify({ message: 'provider_failed', provider: 'ufasofilmebi.ge', error: error instanceof Error ? error.message : String(error) }));
        }
      }

      // 3. Try chemikino.com
      if (!source || source === 'chemikino.com') {
        try {
          const chemiSeries = await searchChemikino(cleanQ, "series", qEng);
          if (chemiSeries && chemiSeries.length) {
            episodes.push({
              season: season || 1,
              episode: episode || 1,
              playerIndex: 1,
              title: `S${season || 1} / ეპიზოდი ${episode || 1}`,
              pageUrl: chemiSeries[0].file,
              candidate: chemiSeries[0].file,
              streams: chemiSeries,
              source: 'chemikino.com',
            });
          }
        } catch (error) {
          console.error(JSON.stringify({ message: 'provider_failed', provider: 'chemikino.com', error: error instanceof Error ? error.message : String(error) }));
        }
      }

      const seriesGenericProviderIds = ['asia.com.ge', 'geofilms.net', 'kinolab.cc', 'geosaitebi.tv'];
      for (const providerId of seriesGenericProviderIds) {
        if (source && source !== providerId) continue;
        try {
          const streams = await searchExternalProvider(providerId, { query: cleanQ, engQuery: qEng, geoQuery: qGeo, type: 'tv', season, episode });
          if (streams.length) {
            episodes.push({
              season: season || 1,
              episode: episode || 1,
              playerIndex: 1,
              title: `S${season || 1} / ეპიზოდი ${episode || 1}`,
              pageUrl: streams[0].file,
              candidate: streams[0].file,
              streams: wrapStreams(streams, `https://${providerId}/`),
              source: providerId,
            });
          }
        } catch (error) {
          console.error(JSON.stringify({ message: 'provider_failed', provider: providerId, error: error instanceof Error ? error.message : String(error) }));
        }
      }

      // Try Imovs if the requested provider is Imovs or no provider was specified.
      if ((!source || source === 'imovs.ge') && !episodes.length) {
        const { base, html } = await strongSearch(query);
        if (html) {
          const allCandidates = pickMovieLinksFromSearch(html, base);
          const candidates = allCandidates.slice(0, 6);
          // (Original Imovs series code)
          const hostRE = new RegExp("(" + "https?://secvideo\\d*\\.online/embed/\\d+/?" + "|" + "https?://video\\.sibnet\\.ru/shell\\.php\\?videoid=\\d+" + "|" + "https?://csst\\.online/embed/\\d+/?" + "|" + "https?://vkvideo\\.ru/video_ext\\.php\\?[^\"\\'\\s]+" + "|" + "https?://ok\\.ru/videoembed/\\d+" + "|" + "https?://videoapi\\.my\\.mail\\.ru/videos/embed/[^\"\\'\\s]+" + "|" + "https?://my\\.mail\\.ru/.+/video/embed/[^\"\\'\\s]+" + "|" + "https?://stormo\\.online/embed/\\d+/?" + "|" + "https?://myvi\\.ru/player/embed/html/[^\"\\'\\s]+" + ")", "ig");
          function seasonMarksFrom(page) { const marks = []; let mh; const reSeasonHdr = /(სეზონ(?:ი)?|Сезон|Season)\s*([0-9]{1,2})/gi; while ((mh = reSeasonHdr.exec(page)) !== null) marks.push({ season: parseInt(mh[2], 10), index: mh.index }); marks.sort((a, b) => a.index - b.index); return marks; }
          function episodeMarksFrom(page) { const marks = []; let eh; const reEpHdr = /(სერია|Серия|Episode)\s*0?(\d{1,3})/gi; while ((eh = reEpHdr.exec(page)) !== null) marks.push({ num: parseInt(eh[2], 10), index: eh.index }); marks.sort((a, b) => a.index - b.index); return marks; }
          function seasonForIndex(idx, marks) { let s = 1; for (const mk of marks) { if (idx >= mk.index) s = mk.season; else break; } return s; }
          function episodeForIndex(idx, marks) { let e = 1; for (const mk of marks) { if (idx >= mk.index) e = mk.num; else break; } return e; }

          const episodeMap = new Map();
          for (const pageUrl of candidates) {
            const page = await getText(pageUrl, pageUrl);
            if (!page) continue;
            const ordered = [];
            let ma;
            while ((ma = hostRE.exec(page)) !== null) ordered.push({ url: ma[1], index: ma.index });
            const scope = (page.match(/player-tabs__container[\s\S]+?<\/div>\s*<\/div>/i) || [])[0] || page;
            let atr;
            const reAttr = /(data-url|data-src|data-href|data-player|href|onclick|src)=["']([^"']+)["']/gi;
            while ((atr = reAttr.exec(scope)) !== null) {
              let u = atr[2];
              const http = u.match(/https?:\/\/[^"' \t\r\n]+/i) || u.match(/\/\/[^"' \t\r\n]+/i);
              if (http) u = http[0].replace(/^\/\//, "https://");
              if (/^[A-Za-z0-9+/=]{20,}$/.test(u)) { try { const dec = atob(u); const m = dec.match(/https?:\/\/[^"' \t\r\n]+/i); u = m ? m[0] : dec; } catch { /* ignore malformed encoded candidate */ } }
              u = abs(pageUrl, u);
              if (/(secvideo|sibnet|csst\.online\/embed|vkvideo\.ru\/video_ext|ok\.ru\/videoembed|videoapi\.my\.mail\.ru\/videos\/embed|my\.mail\.ru\/.+\/video\/embed|stormo\.online\/embed|myvi\.ru\/player\/embed\/html)/i.test(u)) ordered.push({ url: u, index: atr.index });
            }
            const decoded = decodeBase64Blobs(page);
            let dm;
            while ((dm = hostRE.exec(decoded)) !== null) ordered.push({ url: dm[1], index: -1 });
            const seen = new Set();
            const candsForPage = [];
            for (const it of ordered.sort((a, b) => a.index - b.index)) {
              if (!seen.has(it.url)) { seen.add(it.url); candsForPage.push(it); }
            }
            const sMarks = seasonMarksFrom(page);
            const eMarks = episodeMarksFrom(page);
            const seasonFor = (idx) => seasonForIndex(idx, sMarks);
            const episodeFor = (idx) => episodeForIndex(idx, eMarks);
            let autoEp = 1;
            for (const it of candsForPage) {
              let s = seasonFor(it.index);
              let e = episodeFor(it.index);
              if (!e && eMarks.length === 0) e = autoEp++;
              if (!s) s = 1;
              if (!e) e = 1;
              const res = await resolveCandidate(it.url, pageUrl);
              const list = normalizeAndSort(res.data || []);
              if (!list.length) continue;
              const key = `${s}-${e}`;
              if (!episodeMap.has(key)) episodeMap.set(key, { season: s, episode: e, buckets: [] });
              episodeMap.get(key).buckets.push({ source: it.url, list });
            }
          }
          for (const entry of Array.from(episodeMap.values())) {
            let playerIndex = 1;
            for (const bucket of entry.buckets) {
              const list = bucket.list;
              if (!list || !list.length) continue;
              const wrapped = wrapStreams(list, bucket.source);
              episodes.push({
                season: entry.season,
                episode: entry.episode,
                playerIndex: playerIndex,
                title: playerIndex === 1 ? `S${entry.season} / სერია ${entry.episode}` : `ფლეიერი ${playerIndex}`,
                pageUrl: bucket.source,
                candidate: bucket.source,
                streams: wrapped,
                source: 'imovs.ge'
              });
              playerIndex++;
            }
          }
        }
      }

      if (episodes.length) {
        episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
        return json({
          ok: true,
          episodes,
        });
      }

      return json({
        ok: false,
        error: "episodes_not_found"
      });
    }
    /* ================= HLS proxy ================= */
    if (url.pathname === "/hls") {
      let u = url.searchParams.get("u");
      let ref = url.searchParams.get("ref") || "https://csst.online/embed/";
      if (!u) return json({ ok: false, error: "missing u" });
      if (!isAllowedProxyUrl(u)) return json({ ok: false, error: 'proxy_target_denied', message: 'Media მისამართი დაუშვებელია.' }, 403);
      if (!isAllowedProxyUrl(ref)) ref = 'https://csst.online/embed/';

      // JIT Resolution for packed players
      if (/(?:adjaraneti\.xyz|mykadri\.vip)\/v\//i.test(u)) {
        const resolved = await resolvePackedPlayer(u);
        if (resolved) u = resolved;
      }
      if (!isAllowedProxyUrl(u)) return json({ ok: false, error: 'proxy_target_denied', message: 'Resolved media მისამართი დაუშვებელია.' }, 403);

      const r = await getResp(u, ref, undefined, "hls");
      const length = Number(r.headers.get('Content-Length') || 0);
      if (length > 2_000_000) return json({ ok: false, error: 'playlist_too_large' }, 413);
      const text = await r.text();
      if (text.length > 2_000_000) return json({ ok: false, error: 'playlist_too_large' }, 413);
      const base = new URL(u);

      function rewrite(line) {
        if (/^#EXT-X-KEY/i.test(line)) {
          const m = line.match(/URI="([^"]+)"/i);
          if (m) {
            const keyAbs = new URL(m[1], base).toString();
            const repl = `${SELF}/hlskey?u=${encodeURIComponent(
              keyAbs
            )}&ref=${encodeURIComponent(ref)}`;
            return line.replace(/URI="([^"]+)"/i, `URI="${repl}"`);
          }
          return line;
        }
        if (/^#EXT-X-MAP/i.test(line)) {
          const m = line.match(/URI="([^"]+)"/i);
          if (m) {
            const mapAbs = new URL(m[1], base).toString();
            const repl = `${SELF}/hlsseg?u=${encodeURIComponent(
              mapAbs
            )}&ref=${encodeURIComponent(ref)}`;
            return line.replace(/URI="([^"]+)"/i, `URI="${repl}"`);
          }
          return line;
        }
        if (/^#/.test(line) || !line.trim()) return line;
        const target = new URL(line.trim(), base).toString();
        if (/\.m3u8(?:\?|$)/i.test(target))
          return `${SELF}/hls?u=${encodeURIComponent(target)}&ref=${encodeURIComponent(
            ref
          )}`;
        return `${SELF}/hlsseg?u=${encodeURIComponent(
          target
        )}&ref=${encodeURIComponent(ref)}`;
      }

      const lines = text.split("\n").map(rewrite).join("\n");
      const responseHeaders = {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-cache",
        Vary: 'Origin',
      };
      if (allowedCorsOrigin) responseHeaders["Access-Control-Allow-Origin"] = allowedCorsOrigin;
      return new Response(lines, {
        status: 200,
        headers: responseHeaders,
      });
    }

    if (url.pathname === "/hlsseg") {
      const u = url.searchParams.get("u");
      let ref = url.searchParams.get("ref") || "https://csst.online/embed/";
      if (!u) return json({ ok: false, error: "missing u" });
      if (!isAllowedProxyUrl(u)) return json({ ok: false, error: 'proxy_target_denied' }, 403);
      if (!isAllowedProxyUrl(ref)) ref = 'https://csst.online/embed/';
      const range = req.headers.get("Range");
      const upstream = await getResp(u, ref, range, "hls");
      const h = new Headers(upstream.headers);
      if (allowedCorsOrigin) h.set("Access-Control-Allow-Origin", allowedCorsOrigin);
      h.set('Vary', 'Origin');
      h.set("Cache-Control", "no-cache");
      return new Response(upstream.body, { status: upstream.status, headers: h });
    }

    if (url.pathname === "/hlskey") {
      const u = url.searchParams.get("u");
      let ref = url.searchParams.get("ref") || "https://csst.online/embed/";
      if (!u) return json({ ok: false, error: "missing u" });
      if (!isAllowedProxyUrl(u)) return json({ ok: false, error: 'proxy_target_denied' }, 403);
      if (!isAllowedProxyUrl(ref)) ref = 'https://csst.online/embed/';
      const upstream = await getResp(u, ref, undefined, "hls");
      const h = new Headers(upstream.headers);
      if (allowedCorsOrigin) h.set("Access-Control-Allow-Origin", allowedCorsOrigin);
      h.set('Vary', 'Origin');
      h.set("Cache-Control", "no-cache");
      return new Response(upstream.body, { status: upstream.status, headers: h });
    }

    /* ================= MP4 passthrough ================= */
    if (url.pathname === "/play") {
      const u = url.searchParams.get("u");
      let ref = url.searchParams.get("ref") || "https://csst.online/embed/";
      if (!u) return json({ ok: false, error: "missing u" });
      if (!isAllowedProxyUrl(u)) return json({ ok: false, error: 'proxy_target_denied' }, 403);
      if (!isAllowedProxyUrl(ref)) ref = 'https://csst.online/embed/';

      const refList = uniq([
        ref,
        "https://ok.ru/",
        "https://csst.online/embed/",
        "https://csst.online/",
        "https://my.mail.ru/",
        "https://stormo.online/",
        "https://myvi.ru/",
        null,
      ]);
      const upstream = await tryPlay(u, refList, req.headers.get("Range"));
      const h = new Headers(upstream.headers);
      if (allowedCorsOrigin) h.set("Access-Control-Allow-Origin", allowedCorsOrigin);
      h.set('Vary', 'Origin');
      h.set("Cross-Origin-Resource-Policy", "cross-origin");
      if (!h.get("Content-Type")) h.set("Content-Type", "video/mp4");
      return new Response(upstream.body, { status: upstream.status, headers: h });
    }

    if (url.searchParams.has("ping")) {
      return json({
        ok: true,
        msg:
          "use /imovs?q=... or /imovs-series?q=... or /hls?u=...&ref=... or /play?u=...",
      });
    }

    return json({
      ok: false,
      error:
        "use /imovs?q=... or /imovs-series?q=... or /hls?u=...&ref=... or /play?u=...",
    });
  },
};
