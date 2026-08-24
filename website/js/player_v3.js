// ============================================
//  MyFilm — Player v4
//  Sources (priority order):
//   1. Lumex API (lumex.space) — Georgian, IMDB ID based
//   2. Adjara Worker (imovs.ge) — Georgian, title search
//   3. Fallback iframes (vidsrc / multiembed)
// ============================================

const Player = (() => {

  const WORKER  = window.location.origin; // For Railway deploy. Change to 'https://adjara-proxy.erekleburjanadze.workers.dev' to use Cloudflare Worker
  const LUMEX   = 'https://api.lumex.space/';
  const LSUFFIX = 'clientId=CWfKXLc1ajId&domain=movielab.one&url=movielab.one';
  const MOVIE_SCRAPERS = [
    'adjaranetto.com',
    'Croconet.cam',
    'ufasofilmebi.ge',
    'chemikino.com',
    'imovs.ge',
    'asia.com.ge',
    'geofilms.net',
    'kinolab.cc',
    'geosaitebi.tv',
  ];
  const SERIES_SCRAPERS = [
    'adjaranetto.com',
    'Croconet.cam',
    'ufasofilmebi.ge',
    'imovs.ge',
  ];
  const PROVIDER_REQUEST_TIMEOUT = 22000;
  let currentInfo = null;
  let episodeLoadToken = 0;
  let providerHealthCache = { expiresAt: 0, byType: new Map() };
  const geMovieAvailabilityCache = new Map();

  async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 12000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(resource, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  }

  function buildGeMovieStream(info, episodeInfo = null) {
    const isSeries = info?.type === 'tv' || episodeInfo;
    const rawUrl = isSeries
      ? `https://em.filmx.my/play/?type=serial&id=${info.tmdbId}&name=serial&season=${episodeInfo?.season || 1}&episode=${episodeInfo?.episode || 1}&lang=ka`
      : `https://em.filmx.my/play/?type=movie&id=${info.tmdbId}&lang=ka`;
    return { isIframe: true, file: rawUrl, rawUrl, label: 'ge.movie', source: 'ge.movie' };
  }

  async function hasGeMovie(info, episodeInfo = null) {
    if (!info?.tmdbId) return false;
    const type = info.type === 'tv' || episodeInfo ? 'tv' : 'movie';
    const season = Number(episodeInfo?.season || 1);
    const episode = Number(episodeInfo?.episode || 1);
    const cacheKey = `${type}:${info.tmdbId}:${season}:${episode}`;
    if (geMovieAvailabilityCache.has(cacheKey)) return geMovieAvailabilityCache.get(cacheKey);

    try {
      const endpoint = new URL(`${WORKER}/api/ge-movie/status`);
      endpoint.searchParams.set('type', type);
      endpoint.searchParams.set('id', info.tmdbId);
      if (type === 'tv') {
        endpoint.searchParams.set('season', season);
        endpoint.searchParams.set('episode', episode);
      }
      const response = await fetchWithTimeout(endpoint, { timeout: 9000 });
      const data = await response.json();
      const available = response.ok && data?.ok === true && data?.available === true;
      geMovieAvailabilityCache.set(cacheKey, available);
      return available;
    } catch {
      geMovieAvailabilityCache.set(cacheKey, false);
      return false;
    }
  }

  async function healthyProviderIds(type) {
    const now = Date.now();
    if (providerHealthCache.expiresAt > now && providerHealthCache.byType.has(type)) return providerHealthCache.byType.get(type);
    try {
      const response = await fetchWithTimeout(`${WORKER}/api/providers/status?type=${encodeURIComponent(type)}`, { timeout: 7000 });
      const data = await response.json();
      const ids = new Set((data.providers || []).filter(provider => provider.healthy).map(provider => provider.id));
      providerHealthCache.byType.set(type, ids);
      providerHealthCache.expiresAt = now + 5 * 60 * 1000;
      return ids;
    } catch {
      return new Set(['ge.movie']);
    }
  }

  async function visibleStreams(streams, type) {
    const healthy = await healthyProviderIds(type);
    return streams.filter(stream => !stream.isPlaceholder || healthy.has(stream.label));
  }

  function realStreams(streams) {
    const seenProviders = new Set();
    const seenUrls = new Set();
    const filtered = (streams || []).filter(stream => {
      if (!stream || stream.isPlaceholder) return false;
      const url = stream.file || stream.rawUrl;
      if (!url) return false;
      const provider = String(stream.source || stream.label || '').trim().toLowerCase();
      let canonicalUrl = String(stream.rawUrl || stream.file || '').replace(/&amp;/gi, '&');
      try {
        const parsed = new URL(stream.file || '', WORKER);
        if (parsed.origin === new URL(WORKER).origin && /^\/(?:play|hls)$/.test(parsed.pathname) && parsed.searchParams.get('u')) {
          canonicalUrl = parsed.searchParams.get('u');
        }
      } catch { /* the raw string remains the deduplication key */ }
      if (/(?:https?:\/\/)?(?:[^/]+\.)?myvi\.ru(?:[/:]|$)/i.test(canonicalUrl)) return false;
      if ((provider && seenProviders.has(provider)) || seenUrls.has(canonicalUrl)) return false;
      if (provider) seenProviders.add(provider);
      seenUrls.add(canonicalUrl);
      return true;
    });
    return filtered.sort((a, b) => {
      const aIsGeMovie = String(a.source || a.label || '').toLowerCase() === 'ge.movie';
      const bIsGeMovie = String(b.source || b.label || '').toLowerCase() === 'ge.movie';
      return Number(bIsGeMovie) - Number(aIsGeMovie);
    });
  }

  function realEpisodes(episodes) {
    const list = (episodes || [])
      .map(ep => ({ ...ep, streams: realStreams(ep.streams) }))
      .filter(ep => ep.streams.length);
    if (episodes && episodes.overview) list.overview = episodes.overview;
    return list;
  }

  function streamForProvider(streams, provider) {
    const candidates = (streams || []).map(stream => {
      if (!stream) return null;
      let target = stream.rawUrl || stream.file || '';
      let isWorkerMediaProxy = false;
      try {
        const parsed = new URL(stream.file || '', WORKER);
        if (parsed.origin === new URL(WORKER).origin && /^\/(?:play|hls)$/.test(parsed.pathname) && parsed.searchParams.get('u')) {
          target = parsed.searchParams.get('u');
          isWorkerMediaProxy = parsed.pathname === '/hls' || /\.(?:m3u8|mp4)(?:[/?#]|$)/i.test(target);
        }
      } catch { /* malformed candidates are rejected below */ }

      if (!target || /(?:vidsrc|vsembed|streamingnow\.mov|(?:https?:\/\/)?(?:[^/]+\.)?myvi\.ru(?:[/:]|$)|youtube\.com|youtu\.be|trailer|treiler)/i.test(target)) return null;
      try {
        const targetUrl = new URL(target);
        const providerHost = String(provider || '').toLowerCase().replace(/^www\./, '');
        const targetHost = targetUrl.hostname.toLowerCase().replace(/^www\./, '');
        if (providerHost.includes('.') && targetHost === providerHost
          && !/(?:embed|player|video|stream)/i.test(targetUrl.pathname)
          && !/\.(?:m3u8|mp4)(?:[/?#]|$)/i.test(target)) return null;
      } catch { return null; }
      const isDirectMedia = isWorkerMediaProxy || stream.isIframe === false || /\.(?:m3u8|mp4)(?:[/?#]|$)/i.test(target);
      const isHttpsIframe = /^https:\/\//i.test(target) && stream.isIframe !== false;
      if (!isDirectMedia && !isHttpsIframe) return null;
      return {
        stream: {
          ...stream,
          rawUrl: target,
          isIframe: isDirectMedia ? false : true,
          label: provider,
          source: provider,
        },
        score: isDirectMedia ? 2 : 1,
      };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    return candidates[0]?.stream || null;
  }

  function mergeEpisodeGroups(groups) {
    const episodeMap = new Map();
    let overview = '';

    for (const group of groups || []) {
      if (!group) continue;
      if (!overview && group.overview) overview = group.overview;
      for (const episode of group) {
        const season = Number(episode.season) || 1;
        const episodeNumber = Number(episode.episode) || 1;
        const key = `${season}-${episodeNumber}`;
        if (!episodeMap.has(key)) {
          episodeMap.set(key, {
            ...episode,
            season,
            episode: episodeNumber,
            streams: [],
          });
        }
        episodeMap.get(key).streams.push(...realStreams(episode.streams));
      }
    }

    const merged = [...episodeMap.values()]
      .map(episode => ({ ...episode, streams: realStreams(episode.streams) }))
      .filter(episode => episode.streams.length)
      .sort((a, b) => a.season - b.season || a.episode - b.episode);
    if (overview) merged.overview = overview;
    return merged;
  }

  function htmlEscape(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─── HLS.js lazy loader ───
  let _hls = null;
  async function loadHls() {
    if (_hls !== null) return _hls;
    return new Promise(res => {
      if (window.Hls) { _hls = window.Hls; res(_hls); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js';
      s.onload  = () => { _hls = window.Hls; res(_hls); };
      s.onerror = () => { _hls = false; res(false); };
      document.head.appendChild(s);
    });
  }

  let _hlsInst = null;
  function destroyHls() {
    if (_hlsInst) { try { _hlsInst.destroy(); } catch { /* stale HLS instances may already be detached */ } _hlsInst = null; }
  }

  // ─── Attach HLS or MP4 ───
  async function attachStream(video, url) {
    destroyHls();
    video.pause();
    const isHls = /\.m3u8/i.test(url);
    if (isHls) {
      const Hls = await loadHls();
      if (Hls && Hls.isSupported()) {
        const h = new Hls();
        h.loadSource(url);
        h.attachMedia(video);
        h.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
        h.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.error('HLS error:', data);
            video.dispatchEvent(new Event('error'));
          }
        });
        _hlsInst = h;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url; video.play().catch(()=>{});
      }
    } else {
      video.src = url; video.play().catch(()=>{});
    }
  }

  // ─── Native player HTML ───
  function nativeHtml(streams, selectedIdx = 0) {
    const opts = streams.map((s,i) =>
      `<option value="${i}" ${i===selectedIdx?'selected':''}>${htmlEscape(s.label||'auto')}</option>`).join('');
    return `
      <div class="native-player-wrap">
        <video id="main-video" class="main-video" controls playsinline preload="metadata"></video>
        ${streams.length>1?`
        <div class="quality-bar">
          <label class="ql-label">🎞 ხარისხი:</label>
          <select id="quality-select" class="quality-select">${opts}</select>
        </div>`:''}
        <div class="geo-badge">🇬🇪 ქართულად</div>
      </div>`;
  }

  async function renderNative(el, streams, onErrorFallback) {
    streams = realStreams(streams);
    if (!streams.length) {
      el.innerHTML = `
        <div class="player-error">
          <div class="pe-icon">🔍</div>
          <div class="pe-msg">ამ ჩანაწერზე ქართული წყარო ვერ მოიძებნა</div>
          <div class="pe-sub">სცადე სხვა ფილმი, სერია ან ანიმე</div>
        </div>`;
      return;
    }

    const geMovieIdx = streams.findIndex(stream => String(stream.source || stream.label || '').toLowerCase() === 'ge.movie');
    const preferredLabel = localStorage.getItem('myfilm_preferred_stream') || '';
    const preferredIdx = streams.findIndex(stream => (stream.label || '').toLowerCase() === preferredLabel.toLowerCase());
    let currentIdx = geMovieIdx !== -1 ? geMovieIdx : Math.max(preferredIdx, 0);

    el.innerHTML = nativeHtml(streams, currentIdx);
    const video = el.querySelector('#main-video');
    const sel   = el.querySelector('#quality-select');

    let iframeWrap = document.createElement('div');
    iframeWrap.className = 'iframe-player-wrap';
    iframeWrap.style.display = 'none';
    iframeWrap.style.width = '100%';
    iframeWrap.style.height = '100%';
    el.querySelector('.native-player-wrap').appendChild(iframeWrap);

    async function applyStream(idx) {
      const stream = streams[idx];
      
      // On-demand search for placeholder streams!
      if (stream.isPlaceholder) {
        video.style.display = 'none';
        video.pause();
        destroyHls();
        iframeWrap.style.display = 'block';
        iframeWrap.innerHTML = loadingHtml(`მიმდინარეობს ძებნა: ${stream.label}...`);
        
        try {
          const q = cleanSeriesTitle(currentInfo.title || currentInfo.name);
          let fetchUrl = '';
          if (stream.searchType === 'series') {
            fetchUrl = `${WORKER}/imovs-series?q=${encodeURIComponent(q)}&eng=${encodeURIComponent(cleanSeriesTitle(currentInfo.origTitle || ''))}&source=${stream.label}&season=${stream.season}&episode=${stream.episode}`;
          } else {
            fetchUrl = `${WORKER}/imovs?q=${encodeURIComponent(q)}&eng=${encodeURIComponent(cleanSeriesTitle(currentInfo.origTitle || ''))}&source=${stream.label}`;
          }
          
          const r = await fetchWithTimeout(fetchUrl, { timeout: 12000 });
          const d = await r.json();
          
          let foundStream = null;
          if (stream.searchType === 'series') {
            if (d?.episodes) {
              const ep = d.episodes.find(x => x.season === stream.season && x.episode === stream.episode);
              if (ep && ep.streams && ep.streams.length) {
                foundStream = ep.streams.find(s => s.label === stream.label || s.source === stream.label);
                if (!foundStream) foundStream = ep.streams[0];
              }
            }
          } else {
            if (d?.players) {
              const pl = d.players.find(x => x.source === stream.label);
              if (pl && pl.streams && pl.streams.length) {
                foundStream = pl.streams[0];
              }
            }
          }
          
          if (foundStream && foundStream.file) {
            stream.file = foundStream.file;
            stream.rawUrl = foundStream.rawUrl;
            stream.isIframe = foundStream.isIframe;
            stream.isPlaceholder = false;
            await applyStream(idx);
          } else {
            const option = sel?.querySelector(`option[value="${idx}"]`);
            option?.remove();
            iframeWrap.innerHTML = `
              <div class="player-error">
                <div class="pe-icon">🔍</div>
                <div class="pe-msg">წყარო ვერ მოიძებნა ამ საიტზე (${htmlEscape(stream.label)})</div>
                <div class="pe-sub">სცადე სხვა წყარო ჩამოსაშლელი სიიდან</div>
              </div>`;
            UI.toast(`${stream.label} ამ ჩანაწერზე მიუწვდომელია`);
          }
        } catch (e) {
          console.error("On-demand search error:", e);
          iframeWrap.innerHTML = `
            <div class="player-error">
              <div class="pe-icon">⚠️</div>
              <div class="pe-msg">ძიებისას დაფიქსირდა შეცდომა (&nbsp;${htmlEscape(stream.label)}&nbsp;)</div>
              <div class="pe-sub">სცადე მოგვიანებით ან აირჩიე სხვა წყარო</div>
            </div>`;
        }
        return;
      }
      
      // Sandbox bypass for trusted Google Drive files!
      const isGoogleDrive = (stream.rawUrl || stream.file || '').includes('drive.google.com');
      const sandboxAttr = '';

      const isIframe = stream.isIframe !== undefined ? stream.isIframe : (!/\.(mp4|m3u8)$/i.test(stream.rawUrl || '') && !(stream.rawUrl || '').includes('/proxy'));
      
      if (isIframe) {
        video.style.display = 'none';
        video.pause();
        destroyHls();
        iframeWrap.style.display = 'block';
        loadIframeWithoutHistory(iframeWrap, stream.rawUrl || stream.file, !isGoogleDrive, `🇬🇪 ${stream.label || 'Web ფლეიერი'}`);
      } else {
        iframeWrap.style.display = 'none';
        iframeWrap.innerHTML = '';
        video.style.display = 'block';
        await attachStream(video, stream.file);
      }
    }
// ── Auto-retry on error: try next lower quality ──
    video.addEventListener('error', async () => {
      const next = currentIdx + 1;
      if (next < streams.length) {
        currentIdx = next;
        if (sel) sel.value = next;
        await applyStream(next);
      } else {
        // All qualities failed
        let handled = false;
        if (onErrorFallback) {
          handled = await onErrorFallback();
        }
        if (!handled) {
          const evt = new CustomEvent('PlayerVideoError', { cancelable: true });
          handled = !window.dispatchEvent(evt);
        }
        if (handled) return; // detail.js handled it and switched player

        // A ref parameter is a provider/catalog page, never a playable iframe.
        video.style.display = 'none';
        iframeWrap.style.display = 'block';
        iframeWrap.innerHTML = `
          <div class="player-error">
            <div class="pe-icon">⚠️</div>
            <div class="pe-msg">ვიდეო ვერ ჩაიტვირთა (${streams.length > 1 ? 'ყველა ხარისხი' : 'წყარო'} მიუწვდომელია)</div>
            <div class="pe-sub">სცადე სხვა წყარო ან სხვა ფლეიერი</div>
          </div>`;
      }
    });

    await applyStream(currentIdx);

    if (sel) {
      sel.addEventListener('change', () => {
        currentIdx = parseInt(sel.value);
        const selectedStream = streams[currentIdx];
        if (selectedStream && selectedStream.label) {
          localStorage.setItem('myfilm_preferred_stream', selectedStream.label);
        }
        const t = video.currentTime;
        applyStream(currentIdx).then(()=>{ if(video.style.display!=='none') video.currentTime = t; });
      });
    }
  }

  // ─── Iframe HTML ───
  function iframeHtml(url, label) {
    if (url.includes('vidsrc') || url.includes('streamingnow.mov')) {
      return `
        <div class="iframe-player-wrap">
          <div class="player-error" style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;background:#0a0a0f;color:#fff;text-align:center;padding:20px;">
            <div class="pe-icon" style="font-size:48px;margin-bottom:10px;">⚠️</div>
            <div class="pe-msg" style="font-size:18px;font-weight:bold;margin-bottom:5px;">უცხოური ფლეიერი (Vidsrc) დაიბლოკა</div>
            <div class="pe-sub" style="font-size:14px;color:#888;">გთხოვთ აირჩიოთ სხვა ქართული წყარო სიიდან</div>
          </div>
        </div>`;
    }
    return `
      <div class="iframe-player-wrap">
        <iframe src="${htmlEscape(url)}" allowfullscreen sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          referrerpolicy="no-referrer"
          style="width:100%;height:100%;border:none;display:block"></iframe>
        <div class="iframe-badge">${label}</div>
      </div>`;
  }

    function loadIframeWithoutHistory(container, url, useSandbox, label) {
    if (url.includes('vidsrc') || url.includes('streamingnow.mov')) {
      container.innerHTML = `
        <div class="player-error" style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;background:#0a0a0f;color:#fff;text-align:center;padding:20px;">
          <div class="pe-icon" style="font-size:48px;margin-bottom:10px;">⚠️</div>
          <div class="pe-msg" style="font-size:18px;font-weight:bold;margin-bottom:5px;">უცხოური ფლეიერი (Vidsrc) დაიბლოკა</div>
          <div class="pe-sub" style="font-size:14px;color:#888;">გთხოვთ აირჩიოთ სხვა ქართული წყარო სიიდან</div>
        </div>`;
      return;
    }
    container.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.allowFullscreen = true;
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
    iframe.referrerPolicy = 'no-referrer';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    
    if (useSandbox) iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
    
    container.appendChild(iframe);
    
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.location.replace(url);
      } catch (e) {
        iframe.src = url;
      }
    } else {
      iframe.src = url;
    }
    
    if (label) {
      const badge = document.createElement('div');
      badge.className = 'iframe-badge';
      badge.textContent = label;
      container.appendChild(badge);
    }
  }

// ─── Loading HTML ───
  function loadingHtml(msg) {
    return `
      <div class="player-loading">
        <div class="spinner"></div>
        <p>${msg}</p>
        <p id="player-status" style="font-size:0.76rem;color:#444;margin-top:4px"></p>
      </div>`;
  }
  function setStatus(msg) {
    const el = document.getElementById('player-status');
    if (el) el.textContent = msg;
  }

  // ─── Fallback UI ───
  function showFallback(el, info, type) {
    const tmdbId = info.tmdbId || '';
    const query = cleanSeriesTitle(info.title || info.name);
    
    const srcs = info.geMovieAvailable === false ? [] : [
      { name:'🇬🇪 ge.movie', url: type==='tv' ? `https://em.filmx.my/play/?type=serial&id=${tmdbId}&name=serial&season=1&episode=1&lang=ka` : `https://em.filmx.my/play/?type=movie&id=${tmdbId}&lang=ka` },
    ];
    const btns = srcs.map(s=>
      `<button class="fallback-source-btn" data-url="${s.url}" data-name="${s.name}">${s.name}</button>`).join('');

    el.innerHTML = `
      <div class="player-fallback">
        <div class="pf-icon">🇬🇪</div>
        <div class="pf-msg">ქართული წყარო ვერ მოიძებნა</div>
        <div class="pf-sub">სცადე სხვა წყარო (შეიძლება ინგლისური)</div>
        <div class="pf-btns">${btns}</div>
      </div>`;

    el.querySelectorAll('.fallback-source-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        const name = btn.dataset.name;
        
        el.querySelectorAll('.fallback-source-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        el.querySelector('.pf-area')?.remove();
        const area = document.createElement('div');
        area.className = 'pf-area';
        el.appendChild(area);
        
        const isGoogleDrive = url.includes('drive.google.com');
        loadIframeWithoutHistory(area, url, !isGoogleDrive, name);
      });
    });
  }
// ══════════════════════════════════════════
  //  SOURCE 1: imovs.ge Worker
  // ══════════════════════════════════════════

  // ══════════════════════════════════════════
  //  SOURCE 2: imovs.ge Worker
  // ══════════════════════════════════════════
    function cleanSeriesTitle(title) {
    if (!title) return '';
    return title
      .replace(/:\s*სეზონი\s*\d+/gi, '')
      .replace(/\s*სეზონი\s*\d+/gi, '')
      .replace(/:\s*season\s*\d+/gi, '')
      .replace(/\s*season\s*\d+/gi, '')
      .replace(/:\s*s\d+/gi, '')
      .replace(/\s*s\d+/gi, '')
      .replace(/\s*სეზონი/gi, '')
      .replace(/\s*season/gi, '')
      .trim();
  }

function hasCJK(str) {
    return /[\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/u.test(str || '');
  }

  function buildQueries(info) {
    const qs = new Set();
    const add = (t) => { if(t) qs.add(t.trim()); };
    
    const title = info.title || '';      // usually English
    const orig  = info.origTitle || ''; // may be Japanese
    
    // If original title has CJK chars, skip it — use English title only
    const useOrig = orig && !hasCJK(orig);
    
    if (useOrig) {
      if (info.year) add(`${orig} ${info.year}`);
      add(orig);
    }
    // Also try English title
    if (title && title !== orig) {
      if (info.year) add(`${title} ${info.year}`);
      add(title);
    }
    // If only orig and it's CJK, use title only
    if (!useOrig && !title && orig) add(orig);
    
    return [...qs].filter(Boolean);
  }

  async function tryWorkerMovie(info) {
    const queries = buildQueries(info);
    const englishTitle = cleanSeriesTitle(info.origTitle || info.title || '');
    const geMoviePromise = hasGeMovie(info);
    setStatus(`🔍 ${MOVIE_SCRAPERS.length} ქართულ წყაროზე ძიება...`);

    const found = await Promise.all(MOVIE_SCRAPERS.map(async provider => {
      for (const q of queries) {
        try {
          const endpoint = new URL(`${WORKER}/imovs`);
          endpoint.searchParams.set('q', q);
          if (info.year) endpoint.searchParams.set('year', info.year);
          endpoint.searchParams.set('eng', englishTitle);
          endpoint.searchParams.set('source', provider);
          const response = await fetchWithTimeout(endpoint, { timeout: PROVIDER_REQUEST_TIMEOUT });
          if (!response.ok) continue;
          const data = await response.json();
          const player = data?.players?.find(candidate => candidate.source?.toLowerCase() === provider.toLowerCase())
            || data?.players?.[0];
          const stream = streamForProvider(player?.streams || data?.data, provider);
          if (stream) return stream;
        } catch (error) {
          console.debug(`Provider unavailable: ${provider}`, error);
        }
      }
      return null;
    }));

    const streams = found.filter(Boolean);
    info.geMovieAvailable = await geMoviePromise;
    if (info.geMovieAvailable) {
      streams.unshift(buildGeMovieStream(info));
    }

    const normalized = realStreams(streams);
    return normalized.length ? [{ streams: normalized }] : null;
  }

  async function tryWorkerSeries(info) {
    if (info.animetv_url) {
      setStatus(`🔍 ძიება... (Custom)`);
      try {
        const r = await fetchWithTimeout(`${WORKER}/animetv_page?url=${encodeURIComponent(info.animetv_url)}`, { timeout: 6000 });
        const d = await r.json();
        if (d?.episodes?.length) {
          const arr = d.episodes;
          if (d.overview) arr.overview = d.overview;
          return realEpisodes(arr);
        }
      } catch { /* custom AnimeTV source is optional */ }
      return null;
    }

    const queries = buildQueries(info);
    const englishTitle = cleanSeriesTitle(info.origTitle || info.title || '');
    const scraperIds = [...SERIES_SCRAPERS, 'animeb.ge', 'animetv.ge'];
    setStatus(`🔍 ${scraperIds.length} ქართულ წყაროზე ძიება...`);

    const groups = await Promise.all(scraperIds.map(async provider => {
      for (const q of queries) {
        try {
          let endpoint;
          if (provider === 'animeb.ge') {
            endpoint = new URL(`${WORKER}/animeb`);
          } else if (provider === 'animetv.ge') {
            endpoint = new URL(`${WORKER}/animetv`);
          } else {
            endpoint = new URL(`${WORKER}/imovs-series`);
            endpoint.searchParams.set('eng', englishTitle);
            endpoint.searchParams.set('source', provider);
          }
          endpoint.searchParams.set('q', q);
          if (info.year) endpoint.searchParams.set('year', info.year);
          const response = await fetchWithTimeout(endpoint, { timeout: PROVIDER_REQUEST_TIMEOUT });
          if (!response.ok) continue;
          const data = await response.json();
          if (!data?.episodes?.length) continue;

          const episodes = data.episodes.map(episode => {
            const stream = streamForProvider(episode.streams, provider);
            return { ...episode, streams: stream ? [stream] : [] };
          }).filter(episode => episode.streams.length);
          if (data.overview) episodes.overview = data.overview;
          if (episodes.length) return episodes;
        } catch (error) {
          console.debug(`Provider unavailable: ${provider}`, error);
        }
      }
      return null;
    }));

    let result = mergeEpisodeGroups(groups);

    if (result.length && info.tmdbId) {
      result.forEach(ep => {
        const geMovieStream = { isIframe: true, file: `https://em.filmx.my/play/?type=serial&id=${info.tmdbId}&name=serial&season=${ep.season}&episode=${ep.episode}&lang=ka`, rawUrl: `https://em.filmx.my/play/?type=serial&id=${info.tmdbId}&name=serial&season=${ep.season}&episode=${ep.episode}&lang=ka`, label: "ge.movie", source: "ge.movie" };
        if (ep.streams) {
          ep.streams.unshift(geMovieStream);
        } else {
          ep.streams = [geMovieStream];
        }
      });
    }

    return mergeEpisodeGroups([result]);
  }

  async function discoverEpisodeStreams(episodeInfo, existingStreams) {
    if (!episodeInfo || currentInfo?.animetv_url) return realStreams(existingStreams);

    const geMoviePromise = hasGeMovie(currentInfo, episodeInfo);
    const existing = realStreams(existingStreams).filter(stream => String(stream.source || stream.label || '').toLowerCase() !== 'ge.movie');
    const existingProviders = new Set(existing.map(stream => String(stream.source || stream.label || '').toLowerCase()));
    const missingProviders = SERIES_SCRAPERS.filter(provider => !existingProviders.has(provider.toLowerCase()));

    const queries = buildQueries(currentInfo || {});
    const englishTitle = cleanSeriesTitle(currentInfo?.origTitle || currentInfo?.title || '');
    const discovered = await Promise.all(missingProviders.map(async provider => {
      for (const q of queries) {
        try {
          const endpoint = new URL(`${WORKER}/imovs-series`);
          endpoint.searchParams.set('q', q);
          endpoint.searchParams.set('eng', englishTitle);
          endpoint.searchParams.set('source', provider);
          endpoint.searchParams.set('season', episodeInfo.season);
          endpoint.searchParams.set('episode', episodeInfo.episode);
          const response = await fetchWithTimeout(endpoint, { timeout: PROVIDER_REQUEST_TIMEOUT });
          if (!response.ok) continue;
          const data = await response.json();
          const episode = data?.episodes?.find(candidate =>
            Number(candidate.season) === Number(episodeInfo.season)
            && Number(candidate.episode) === Number(episodeInfo.episode));
          const stream = streamForProvider(episode?.streams, provider);
          if (stream) return stream;
        } catch (error) {
          console.debug(`Episode provider unavailable: ${provider}`, error);
        }
      }
      return null;
    }));

    const geMovieAvailable = await geMoviePromise;
    currentInfo.geMovieAvailable = geMovieAvailable;
    const streams = realStreams([
      ...(geMovieAvailable ? [buildGeMovieStream(currentInfo, episodeInfo)] : []),
      ...existing,
      ...discovered.filter(Boolean),
    ]);
    episodeInfo.streams = streams;
    return streams;
  }

  // ══════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════

  async function loadMovie(containerId, info) {
    const el = document.getElementById(containerId);
    if (!el) return;
    currentInfo = info;

    const isCustom = info.is_custom || !info.tmdbId;
    if (isCustom) {
      el.innerHTML = loadingHtml('წყაროების ჩატვირთვა...');
      const players = await tryWorkerMovie(info);
      if (players?.length) {
        await renderNative(el, players[0].streams, null);
      } else {
        showFallback(el, info, 'movie');
      }
      return;
    }

    el.innerHTML = loadingHtml('წყაროები იტვირთება...');
    const players = await tryWorkerMovie(info);
    if (players?.length && players[0].streams?.length) {
      await renderNative(el, players[0].streams, null);
    } else {
      showFallback(el, info, 'movie');
    }
  }

  async function loadSeries(containerId, info, onReady) {
    const el = document.getElementById(containerId);
    if (!el) return null;
    currentInfo = info;

    const isCustom = info.animetv_url || !info.tmdbId;
    if (isCustom) {
      el.innerHTML = loadingHtml('🔍 სერიების ძიება...');
      const episodes = await tryWorkerSeries(info);
      if (episodes?.length) {
        if (onReady) onReady(episodes);
        return { type: 'worker', episodes };
      }
      info.geMovieAvailable = await hasGeMovie(info, { season: 1, episode: 1 });
      showFallback(el, info, 'tv');
      return null;
    }

    if (info.seasons && onReady) {
      el.innerHTML = loadingHtml('წყაროები იტვირთება...');
      const episodes = await tryWorkerSeries(info);
      if (episodes?.length) {
        onReady(episodes);
        return { type: 'worker', episodes };
      }
    }

    info.geMovieAvailable = await hasGeMovie(info, { season: 1, episode: 1 });
    showFallback(el, info, 'tv');
    return null;
  }

  // Load episode from worker episodes array
  async function loadEpisode(containerId, streams, onErrorFallback, episodeInfo) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const loadToken = ++episodeLoadToken;
    el.innerHTML = loadingHtml('ქართული წყაროები მოწმდება...');
    const discovered = await discoverEpisodeStreams(episodeInfo, streams);
    if (loadToken !== episodeLoadToken) return;
    await renderNative(el, discovered, onErrorFallback);
  }

  function destroy() {
    episodeLoadToken += 1;
    destroyHls();
    const v = document.getElementById('main-video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    const c = document.getElementById('player-container');
    if (c) {
      c.querySelectorAll('iframe').forEach(ifr => {
        ifr.src = 'about:blank';
        ifr.parentNode.removeChild(ifr);
      });
      c.innerHTML = '';
    }
  }
  return { loadMovie, loadSeries, loadEpisode, destroy };

})();
