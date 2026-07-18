export default {
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, X-Requested-With, Authorization, Accept, Referer, Origin, Range",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(req.url);
    const SELF = url.origin;

    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });

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
      } catch { }
      return h;
    }

    function looksLikeCF(t) {
      return /Attention Required|Just a moment|Cloudflare/i.test(t || "");
    }

    async function getTextDirect(target, referer) {
      const h = withRef(htmlHeaders(), referer);
      try {
        const r = await fetch(target, {
          headers: h,
          redirect: "follow",
          cf: { cacheTtl: 0, cacheEverything: false },
        });
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
      // бѓ–бѓќбѓ’бѓЇбѓ”бѓ  url бѓђбѓ  бѓ›бѓ—бѓђбѓ•бѓ бѓ“бѓ”бѓ‘бѓђ .mp4вЂ“бѓ–бѓ” (бѓ›бѓђбѓ’. okcdn.ru/?type=3&id=...).
      const out = [];
      const re = /"(https?:\/\/[^"']+?)"/gi;
      let m;
      while ((m = re.exec(txt)) !== null) {
        const u = m[1];
        if (/https?:\/\/[^"']+/.test(u) && !/\.m3u8(?:\?|$)/i.test(u)) {
          // бѓ©бѓђбѓ•бѓўбѓќбѓ•бѓќбѓ—, бѓ—бѓЈ бѓ”бѓЎ player-бѓЎ a/v url-бѓ”бѓ‘бѓЎ бѓ’бѓђбѓ•бѓЎ
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
        } catch { }
      }
      return out.join("\n");
    }

    function resNum(labelOrUrl) {
      if (!labelOrUrl) return 0;
      const s = String(labelOrUrl);
      const m = s.match(/(^|[^0-9])(1[0-9]{3}|[0-9]{3})p(?![0-9])/i);
      return m ? parseInt(m[2], 10) : 0;
    }

    // MP4 бѓ¬бѓбѓњ, HLS бѓЈбѓ™бѓђбѓњ
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
      if (nt === nq) return 1.5; // exact match вЂ” highest priority
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
        } catch { }
      } catch { }
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
        } catch { }
      }
      if (vids.length) return { data: normalizeAndSort(vids) };

      // 3) бѓ¤бѓќбѓљбѓ-бѓљбѓбѓњбѓ™бѓ”бѓ‘бѓ
      const links = normalizeAndSort(
        extractMediaLinks(fixed).map((u) => ({
          file: u,
          label: /\.m3u8/i.test(u) ? "HLS" : "auto",
        }))
      );
      if (links.length) return { data: links };

      // 4) бѓ–бѓќбѓ’бѓђбѓ“бѓ URL-бѓ”бѓ‘бѓбѓЄ бѓ•бѓЄбѓђбѓ“бѓќбѓ— (okcdn.ru/?type=3 ...)
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

    // animeb.ge resolver вЂ“ extracts iframe src and resolves the embedded video URL
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

    // my.mail.ru / videoapi.my.mail.ru вЂ” бѓ’бѓђбѓ«бѓљбѓбѓ”бѓ бѓ”бѓ‘бѓЈбѓљбѓ бѓ бѓ”бѓ–бѓќбѓљбѓ•бѓ”бѓ бѓ (бѓћбѓбѓ бѓ“бѓђбѓћбѓбѓ  iframe-бѓбѓ“бѓђбѓњ)
    async function mailruResolve(embedUrl) {
      const ref = 'https://my.mail.ru/';
      const html = await getText(embedUrl, ref);
      const fixed = html.replace(/\\\//g, '/').replace(/\\u0026/g, '&');

      // бѓ›бѓ§бѓбѓЎбѓбѓ”бѓ бѓ HLS (бѓбѓЁбѓ•бѓбѓђбѓ—бѓбѓђ, бѓ›бѓђбѓ’бѓ бѓђбѓ› бѓ“бѓђбѓ•бѓўбѓќбѓ•бѓќбѓ—)
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

      // embed бѓ’бѓ•бѓ”бѓ бѓ“бѓбѓ“бѓђбѓњбѓђбѓЄ бѓђбѓ›бѓќбѓбѓ™бѓ бѓбѓ¤бѓќбѓЎ mp4/m3u8
      extractMediaLinks(fixed).forEach(u => collected.push({ file: u, label: /\.m3u8/i.test(u) ? 'HLS' : 'auto' }));

      // бѓ–бѓќбѓ’бѓђбѓ“бѓ бѓ•бѓбѓ“бѓ”бѓќ URL-бѓ”бѓ‘бѓбѓЄ (mp4 query-бѓ”бѓ‘бѓбѓ—)
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

    /* ================= geosaitebi API ================= */
    function scoreTitle(query, target) {
      if (!query || !target) return 0;
      const qClean = query.toLowerCase().replace(/[^a-z0-9\u10D0-\u10FA]/gi, '');
      const tClean = target.toLowerCase().replace(/[^a-z0-9\u10D0-\u10FA]/gi, '');
      if (qClean === tClean) return 1;
      if (tClean.includes(qClean) || qClean.includes(tClean)) return 0.8;
      return 0;
    }

    async function searchGeosaitebi(q, type) {
      return [];
    }

    async function searchUfasofilmebi(query, type) {
      try {
        const searchUrl = 'https://ufasofilmebi.ge/?s=' + encodeURIComponent(query);
        const r = await fetch(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
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
           let score = scoreTitle(query, res.title);
           if (score > bestScore) {
             bestScore = score;
             bestMatch = res;
           }
        }

        if (bestMatch && bestScore > 0.2) {
          const detailR = await fetch(bestMatch.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
                  } catch(e) {}
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
                  } catch(e) {}
              }
          }
        }
      } catch (e) {
        console.error("ufasofilmebi.ge search error:", e);
      }
      return [];
    }

    async function searchCroconet(query, type, season, episode) {
      try {
        const searchUrl = 'https://croconet.cam/search?q=' + encodeURIComponent(query);
        const r = await fetch(searchUrl, { headers: htmlHeaders() });
        const html = await r.text();
        const links = [...html.matchAll(/href=["'](https?:\/\/croconet\.cam)?(\/(?:movie|show|series|serial)\/\d+\/[^"']+)["']/gi)];
        
        const results = links.map(m => {
           let url = m[2];
           if (!url.startsWith('http')) url = 'https://croconet.cam' + url;
           const parts = url.split('/');
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
          const score = scoreTitle(query, m.title);
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
          const r = await fetch("https://adjaranetto.com/search?q=" + encodeURIComponent(query), {
            headers: htmlHeaders()
          });
          const html = await r.text();
          const scripts = [...html.matchAll(/<script>self\.__next_f.*?<\/script>/gs)];
          if (!scripts.length) return [];

          const allData = scripts.map(s => s[0]).join('');
          const movies = [];
          const seen = new Set();

          // Structure in escaped Next.js JSON: \"id\":10792,\"title\":\"бѓ‘бѓЈбѓњбѓ™бѓ”бѓ бѓ | SILO\",\"title_ka\":\"...\",\"title_en\":null,\"slug\":\"bunkeri-ji\",\"year\":2023
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
        const r = await fetch(url, { headers: htmlHeaders() });
        const html = await r.text();

        const nextFData = [...html.matchAll(/<script>self\.__next_f.*?<\/script>/g)].join('');
        const matches = [...nextFData.matchAll(/\\"url\\":\\"?([^"\\]+)\\"?/g)];
        const validUrls = matches.map(m => m[1]).filter(u => /(sibnet\.ru|incvideo|secvideo|csst\.online|vkvideo|myvi|mykadri\.vip|embed|\.mp4|\.m3u8)/i.test(u));
        if (validUrls.length) return validUrls[0];
      } catch (e) { }
      return null;
    }

    // Resolve packed-JS video players (adjaraneti.xyz, mykadri.vip, and similar)
    async function resolvePackedPlayer(url) {
      try {
        const domain = new URL(url).hostname; // e.g. adjaraneti.xyz or mykadri.vip
        const res = await fetch(url, {
          headers: { ...htmlHeaders(), 'Referer': 'https://adjaranetto.com/' }
        });
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
            decoded = eval(packedExpr); // fallback just in case
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
      } catch (e) { }
      return null;
    }

    async function getAdjaranettoSeriesEpisodes(slug) {
      try {
        const url = "https://adjaranetto.com/" + slug + ".html";
        const r = await fetch(url, { headers: htmlHeaders() });
        const html = await r.text();
        const scripts = [...html.matchAll(/<script>self\.__next_f.*?<\/script>/gs)];
        const allData = scripts.map(s => s[0]).join('');

        // Real structure in Next.js RSC (triple-escaped):
        // \"season_id\":69577,\"episode_number\":1,\"title\":\"бѓЎбѓ”бѓ бѓбѓђ 1\",\"url\":\"https://video.sibnet.ru/...\"

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
        } catch { }
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
          } catch { }
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
        const r = await fetch("https://www.imovs.ge/index.php?do=search", {
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
        });
        const t = await r.text();
        if (t && !looksLikeCF(t))
          return { base: "https://www.imovs.ge", html: t };
      } catch { }
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
        if (/\.m3u8(?:\?|$)/i.test(f)) {
          return {
            ...x,
            file: `${SELF}/hls?u=${encodeURIComponent(f)}&ref=${encodeURIComponent(
              referer || "https://csst.online/embed/"
            )}`,
            label: x.label || "HLS",
          };
        }
        // бѓ§бѓ•бѓ”бѓљбѓђ бѓ“бѓђбѓњбѓђбѓ бѓ©бѓ”бѓњбѓ бѓ•бѓбѓ“бѓ”бѓќ URL-бѓЎ бѓ•бѓђбѓўбѓђбѓ бѓ”бѓ‘бѓ— /play-бѓ–бѓ” (бѓ—бѓЈбѓњбѓ“бѓђбѓЄ бѓ’бѓђбѓ¤бѓђбѓ бѓ—бѓќбѓ”бѓ‘бѓђ бѓђбѓ  бѓ”бѓ¬бѓ”бѓ бѓќбѓЎ)
        return {
          ...x,
          file: `${SELF}/play?u=${encodeURIComponent(f)}&ref=${encodeURIComponent(
            referer || "https://csst.online/embed/"
          )}`,
          label: x.label || "auto",
        };
      });
    }

    /* ================= ROUTES ================= */

    // MOVIE

    // MOVIE
      if (url.pathname === '/test-sources') {
        const q = url.searchParams.get('q') || 'spider-man';
        const geo = await searchGeosaitebi(q, "movie").catch(e => ({error: e.message}));
        const ufaso = await searchUfasofilmebi(q, "movie").catch(e => ({error: e.message}));
        const adja = await searchAdjaranetto(q).catch(e => ({error: e.message}));
        return json({ q, geo, ufaso, adja });
      }

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

      const qEng = extractEnglishTitle(cleanQ);
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

      // 1.5 Try Croconet.cam
      if (!source || source === 'Croconet.cam') {
        try {
          const crocoStreams = await searchCroconet(cleanQ, "series", season, episode);
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
        } catch (err) {}
      }

      // 2. Try ufasofilmebi.ge
      if (!source || source === 'ufasofilmebi.ge') {
        try {
          const ufasoMovies = await searchUfasofilmebi(cleanQ, "movie");
          if (ufasoMovies && ufasoMovies.length) {
             allPlayers.push({ streams: ufasoMovies, candidate: ufasoMovies[0].file, source: "ufasofilmebi.ge" });
          }
        } catch (e) {}
      }

      // 3. Try chemikino.com
      if (!source || source === 'chemikino.com') {
        try {
          const chemiStreams = await searchChemikino(cleanQ, "movie");
          if (chemiStreams && chemiStreams.length) {
             allPlayers.push({ streams: chemiStreams, candidate: chemiStreams[0].file, source: "chemikino.com" });
          }
        } catch (e) {}
      }

      // 3.5 Try Croconet.cam
      if (!source || source === 'Croconet.cam') {
        try {
          const crocoStreams = await searchCroconet(cleanQ, "movie");
          if (crocoStreams && crocoStreams.length) {
             allPlayers.push({ streams: crocoStreams, candidate: crocoStreams[0].file, source: "Croconet.cam" });
          }
        } catch (e) {}
      }

      // 3.5 Try Croconet.cam
      if (!source || source === 'Croconet.cam') {
        try {
          const crocoStreams = await searchCroconet(cleanQ, "movie");
          if (crocoStreams && crocoStreams.length) {
             allPlayers.push({ streams: crocoStreams, candidate: crocoStreams[0].file, source: "Croconet.cam" });
          }
        } catch (e) {}
      }

      // 4. Try Imovs.ge
      if (source === 'imovs.ge' || (!source && allPlayers.length === 0)) {
        if (true) {
          const { base, html } = await strongSearch(cleanQ);
          if (html) {
            const candidates = pickMovieLinksFromSearch(html, base);
            if (candidates.length) {
              const best = await chooseBestDetail(candidates, cleanQ);
              if (best.url) {
                const pageUrl = best.url;
                const page = best.page || (await getText(pageUrl, pageUrl));
                const frames = [];
                const reI = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
                let m;
                while ((m = reI.exec(page)) !== null) frames.push(abs(pageUrl, m[1]));

                const buttons = [];
                const reB = /(?:href|data-href|data-url|data-player|data-src)=["']([^"']+)["']/gi;
                while ((m = reB.exec(page)) !== null) {
                  const u = abs(pageUrl, m[1]);
                  if (/(watch|player|iframe|play|embed|video)/i.test(u)) buttons.push(u);
                }
                const decoded = decodeBase64Blobs(page);
                const decLinks = extractMediaLinks(decoded);
                const toTry = uniq([...frames, ...buttons, ...decLinks]).filter(
                  (u) => !/googletagmanager\.com|doubleclick\.net/i.test(u)
                ).slice(0, 8);

                for (const f of toTry) {
                  const r = await resolveCandidate(f, pageUrl);
                  const list = normalizeAndSort(r.data || []);
                  if (list.length) {
                    const wrapped = wrapStreams(list, f);
                    allPlayers.push({ streams: wrapped, candidate: f, source: 'imovs.ge' });
                  }
                }
              }
            }
          }
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

        const linkRe = /<a[^>]+href=["'](https?:\/\/animeb\.ge\/anime\/[^"']+\.html)["'][^>]*>/gi;
        const links = [];
        let m;
        while ((m = linkRe.exec(t)) !== null) { if (!links.includes(m[1])) links.push(m[1]); }

        if (!links.length) return json({ ok: false, error: "not_found" });

        const bestUrl = links[0];
        const detailHtml = await getText(bestUrl, "https://animeb.ge/");

        const episodes = [];
        const seasonBlockRe = /(\d+):\s*\[(\{[\s\S]*?\}(?:,\s*\{[\s\S]*?\})*)\s*,?\s*\]/g;
        let hasSeasons = false;

        while ((m = seasonBlockRe.exec(detailHtml)) !== null) {
          hasSeasons = true;
          const seasonNum = parseInt(m[1]);
          const block = m[2];
          const epRe2 = /\{"title"\s*:\s*'([^']+)'\s*,\s*"url"\s*:\s*'([^']+)'\s*\}/g;
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
          const epRe = /\{"title"\s*:\s*'([^']+)'\s*,\s*"url"\s*:\s*'([^']+)'\s*\}/g;
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

        return json({ ok: true, episodes });
      } catch (e) {
        return json({ ok: false, error: e.toString() });
      }
    }

    if (url.pathname === "/animetv_page") {
      const pageUrl = url.searchParams.get("url");
      if (!pageUrl) return json({ ok: false, error: "missing url" });
      try {
        const episodes = [];
        const detailHtml = await getText(pageUrl, "https://animetv.ge/");
        const mPlayers = detailHtml.match(/const\s+allPlayers\s*=\s*(\{[\s\S]*?\});/);
        if (mPlayers) {
          const playersStr = mPlayers[1];
          const pArrays = [...playersStr.matchAll(/(\w+)\s*:\s*\[([\s\S]*?)\]/g)];
          let maxEpisodes = 0;
          const playerMap = [];
          for (const p of pArrays) {
            const urls = [...p[2].matchAll(/['"](https?:\/\/[^'"]+)['"]/g)].map(x => x[1]);
            playerMap.push({ name: p[1], urls });
            if (urls.length > maxEpisodes) maxEpisodes = urls.length;
          }
          let seasonNum = 1;
          const sMatch = pageUrl.match(/season-(\d+)/i) || detailHtml.match(/бѓЎбѓ”бѓ–бѓќбѓњбѓ\s*(\d+)/i);
          if (sMatch) seasonNum = parseInt(sMatch[1], 10);
          for (let epIndex = 1; epIndex <= maxEpisodes; epIndex++) {
            const streams = [];
            let pIdx = 1;
            for (const pm of playerMap) {
              const epUrl = pm.urls[epIndex - 1];
              if (epUrl) {
                streams.push({ file: `${SELF}/play?u=${encodeURIComponent(epUrl)}&ref=${encodeURIComponent(pageUrl)}`, label: "F" + pIdx, rawUrl: epUrl, isIframe: true });
              }
              pIdx++;
            }
            if (streams.length > 0) episodes.push({ season: seasonNum, episode: epIndex, title: "S" + seasonNum + " / E" + epIndex, streams, playerIndex: 1, source: "animetv.ge", candidate: streams[0].rawUrl, pageUrl });
          }
        }
        let overview = '';
        const descMatch = detailHtml.match(/<div class="custom-description">([\s\S]*?)<\/div>/);
        if (descMatch) {
            overview = descMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        return json({ ok: true, episodes, overview });
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

        const linkRe = /<a[^>]+href=["'](https?:\/\/animetv\.ge\/[^"']+\.html)["'][^>]*>/gi;
        const links = [];
        let m;
        while ((m = linkRe.exec(t)) !== null) { if (!links.includes(m[1])) links.push(m[1]); }

        if (!links.length) return json({ ok: false, error: "not_found" });

        const episodes = [];
        
        // Only take the VERY FIRST search result to avoid combining different seasons or animes
        for (const bestUrl of links.slice(0, 1)) {
          const detailHtml = await getText(bestUrl, "https://animetv.ge/");
          
          // Extract allPlayers object
          const mPlayers = detailHtml.match(/const\s+allPlayers\s*=\s*(\{[\s\S]*?\});/);
          if (mPlayers) {
            const playersStr = mPlayers[1];
            const pArrays = [...playersStr.matchAll(/(\w+)\s*:\s*\[([\s\S]*?)\]/g)];
            
            let maxEpisodes = 0;
            const playerMap = [];
            
            for (const p of pArrays) {
              const pName = p[1];
              const urlsStr = p[2];
              const urls = [...urlsStr.matchAll(/['"](https?:\/\/[^'"]+)['"]/g)].map(x => x[1]);
              playerMap.push({ name: pName, urls: urls });
              if (urls.length > maxEpisodes) maxEpisodes = urls.length;
            }
            
            // Season from URL or title
            let seasonNum = 1;
            const sMatch = bestUrl.match(/season-(\d+)/i) || detailHtml.match(/бѓЎбѓ”бѓ–бѓќбѓњбѓ\s*(\d+)/i);
            if (sMatch) seasonNum = parseInt(sMatch[1], 10);

            for (let epIndex = 1; epIndex <= maxEpisodes; epIndex++) {
              const streams = [];
              let pIdx = 1;
              for (const pm of playerMap) {
                const epUrl = pm.urls[epIndex - 1];
                if (epUrl) {
                  const resolvedUrl = `${SELF}/play?u=${encodeURIComponent(epUrl)}&ref=${encodeURIComponent(bestUrl)}`;
                  streams.push({ file: resolvedUrl, label: "F" + pIdx, rawUrl: epUrl, isIframe: true });
                }
                pIdx++;
              }
              if (streams.length > 0) {
                episodes.push({
                  season: seasonNum,
                  episode: epIndex,
                  title: "S" + seasonNum + " / E" + epIndex,
                  streams: streams,
                  playerIndex: 1,
                  source: "animetv.ge",
                  candidate: streams[0].rawUrl,
                  pageUrl: bestUrl
                });
              }
            }
          }
        }

        return json({ ok: true, episodes });
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

      const qEng = extractEnglishTitle(cleanQ);
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
          const crocoStreams = await searchCroconet(cleanQ, "series", season, episode);
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
        } catch (err) {}
      }

      // 2. Try ufasofilmebi.ge
      if (!source || source === 'ufasofilmebi.ge') {
        try {
          const ufasoSeries = await searchUfasofilmebi(cleanQ, "series");
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
        } catch (err) {}
      }

      // 3. Try chemikino.com
      if (!source || source === 'chemikino.com') {
        try {
          const chemiSeries = await searchChemikino(cleanQ, "series");
          if (chemiSeries && chemiSeries.length) {
            // (chemikino series resolver is same, but for simplicity if we found streams we group them)
            // Note: searchChemikino returns array of streams. We match all of them as episode 1 or search page
            // Chemikino is normally movie only, but if they want it in series list, we allow it.
          }
        } catch (err) {}
      }
      // 2. Try Imovs if Adjaranetto failed
      if (!episodes.length) {
        const { base, html } = await strongSearch(query);
        if (html) {
          const allCandidates = pickMovieLinksFromSearch(html, base);
          const candidates = allCandidates.slice(0, 6);
          // (Original Imovs series code)
          const hostRE = new RegExp("(" + "https?://secvideo\\d*\\.online/embed/\\d+/?" + "|" + "https?://video\\.sibnet\\.ru/shell\\.php\\?videoid=\\d+" + "|" + "https?://csst\\.online/embed/\\d+/?" + "|" + "https?://vkvideo\\.ru/video_ext\\.php\\?[^\"\\'\\s]+" + "|" + "https?://ok\\.ru/videoembed/\\d+" + "|" + "https?://videoapi\\.my\\.mail\\.ru/videos/embed/[^\"\\'\\s]+" + "|" + "https?://my\\.mail\\.ru/.+/video/embed/[^\"\\'\\s]+" + "|" + "https?://stormo\\.online/embed/\\d+/?" + "|" + "https?://myvi\\.ru/player/embed/html/[^\"\\'\\s]+" + ")", "ig");
          function seasonMarksFrom(page) { const marks = []; let mh; const reSeasonHdr = /(бѓЎбѓ”бѓ–бѓќбѓњ(?:бѓ)?|РЎРµР·РѕРЅ|Season)\s*([0-9]{1,2})/gi; while ((mh = reSeasonHdr.exec(page)) !== null) marks.push({ season: parseInt(mh[2], 10), index: mh.index }); marks.sort((a, b) => a.index - b.index); return marks; }
          function episodeMarksFrom(page) { const marks = []; let eh; const reEpHdr = /(бѓЎбѓ”бѓ бѓбѓђ|РЎРµСЂРёСЏ|Episode)\s*0?(\d{1,3})/gi; while ((eh = reEpHdr.exec(page)) !== null) marks.push({ num: parseInt(eh[2], 10), index: eh.index }); marks.sort((a, b) => a.index - b.index); return marks; }
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
              if (/^[A-Za-z0-9+/=]{20,}$/.test(u)) { try { const dec = atob(u); const m = dec.match(/https?:\/\/[^"' \t\r\n]+/i); u = m ? m[0] : dec; } catch { } }
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
                title: playerIndex === 1 ? `S${entry.season} / РЎРµСЂРёСЏ ${entry.episode}` : `бѓ¤бѓљбѓ”бѓбѓ”бѓ бѓ ${playerIndex}`,
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
      const ref = url.searchParams.get("ref") || "https://csst.online/embed/";
      if (!u) return json({ ok: false, error: "missing u" });

      // JIT Resolution for packed players
      if (/(?:adjaraneti\.xyz|mykadri\.vip)\/v\//i.test(u)) {
        const resolved = await resolvePackedPlayer(u);
        if (resolved) u = resolved;
      }

      const r = await getResp(u, ref, undefined, "hls");
      const text = await r.text();
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
      return new Response(lines, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        },
      });
    }

    if (url.pathname === "/hlsseg") {
      const u = url.searchParams.get("u");
      const ref = url.searchParams.get("ref") || "https://csst.online/embed/";
      if (!u) return json({ ok: false, error: "missing u" });
      const range = req.headers.get("Range");
      const upstream = await getResp(u, ref, range, "hls");
      const h = new Headers(upstream.headers);
      h.set("Access-Control-Allow-Origin", "*");
      h.set("Cache-Control", "no-cache");
      return new Response(upstream.body, { status: upstream.status, headers: h });
    }

    if (url.pathname === "/hlskey") {
      const u = url.searchParams.get("u");
      const ref = url.searchParams.get("ref") || "https://csst.online/embed/";
      if (!u) return json({ ok: false, error: "missing u" });
      const upstream = await getResp(u, ref, undefined, "hls");
      const h = new Headers(upstream.headers);
      h.set("Access-Control-Allow-Origin", "*");
      h.set("Cache-Control", "no-cache");
      return new Response(upstream.body, { status: upstream.status, headers: h });
    }

    /* ================= MP4 passthrough ================= */
    if (url.pathname === "/play") {
      const u = url.searchParams.get("u");
      const ref = url.searchParams.get("ref") || "https://csst.online/embed/";
      if (!u) return json({ ok: false, error: "missing u" });

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
      h.set("Access-Control-Allow-Origin", "*");
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
