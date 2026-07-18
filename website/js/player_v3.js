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
  let currentInfo = null;

  async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 6000 } = options;
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
    if (_hlsInst) { try { _hlsInst.destroy(); } catch {} _hlsInst = null; }
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
      `<option value="${i}" ${i===selectedIdx?'selected':''}>${s.label||'auto'}</option>`).join('');
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
    const preferredLabel = localStorage.getItem('jarvis_preferred_stream') || 'ge.movie';
    let currentIdx = 0;
    
    // Find index of stream matching the preferred label
    const matchIdx = streams.findIndex(s => (s.label || '').toLowerCase() === preferredLabel.toLowerCase());
    if (matchIdx !== -1) {
      currentIdx = matchIdx;
    }

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
          
          const r = await fetchWithTimeout(fetchUrl, { timeout: 8000 });
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
            iframeWrap.innerHTML = `
              <div class="player-error">
                <div class="pe-icon">🔍</div>
                <div class="pe-msg">წყარო ვერ მოიძებნა ამ საიტზე (${stream.label})</div>
                <div class="pe-sub">სცადე სხვა წყარო ჩამოსაშლელი სიიდან</div>
              </div>`;
          }
        } catch (e) {
          console.error("On-demand search error:", e);
          iframeWrap.innerHTML = `
            <div class="player-error">
              <div class="pe-icon">⚠️</div>
              <div class="pe-msg">ძიებისას დაფიქსირდა შეცდომა (&nbsp;${stream.label}&nbsp;)</div>
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

        // Try to extract iframe URL from ref and fallback to it
        let fallbackIframeUrl = null;
        try {
          const urlObj = new URL(streams[0].file);
          const ref = urlObj.searchParams.get('ref');
          if (ref) {
            fallbackIframeUrl = ref;
          }
        } catch(e) {}

        if (fallbackIframeUrl && fallbackIframeUrl.includes('http')) {
          video.style.display = 'none';
          destroyHls();
          iframeWrap.style.display = 'block';
          iframeWrap.innerHTML = `
            <iframe src="${fallbackIframeUrl}" allowfullscreen
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              referrerpolicy="no-referrer"
              style="width:100%;height:100%;border:none;display:block"></iframe>
            <div class="iframe-badge">🇬🇪 Web ფლეიერი</div>`;
        } else {
          video.style.display = 'none';
          iframeWrap.style.display = 'block';
          iframeWrap.innerHTML = `
            <div class="player-error">
              <div class="pe-icon">⚠️</div>
              <div class="pe-msg">ვიდეო ვერ ჩაიტვირთა (${streams.length > 1 ? 'ყველა ხარისხი' : 'წყარო'} მიუწვდომელია)</div>
              <div class="pe-sub">სცადე სხვა წყარო ან სხვა ფლეიერი</div>
            </div>`;
        }
      }
    });

    await applyStream(currentIdx);

    if (sel) {
      sel.addEventListener('change', () => {
        currentIdx = parseInt(sel.value);
        const selectedStream = streams[currentIdx];
        if (selectedStream && selectedStream.label) {
          localStorage.setItem('jarvis_preferred_stream', selectedStream.label);
        }
        const t = video.currentTime;
        applyStream(currentIdx).then(()=>{ if(video.style.display!=='none') video.currentTime = t; });
      });
    }
  }

  // ─── Iframe HTML ───
  function iframeHtml(url, label) {
    return `
      <div class="iframe-player-wrap">
        <iframe src="${url}" allowfullscreen
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          referrerpolicy="no-referrer"
          style="width:100%;height:100%;border:none;display:block"></iframe>
        <div class="iframe-badge">${label}</div>
      </div>`;
  }

    function loadIframeWithoutHistory(container, url, useSandbox, label) {
    container.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.allowFullscreen = true;
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
    iframe.referrerPolicy = 'no-referrer';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    
    // Sandboxing disabled to allow third-party players to play correctly
    
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
      badge.innerHTML = label;
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
    
    // Dead sources (kinoflix, geosaitebi) deleted. ufasofilmi updated to ufasofilmebi.ge
    const srcs = [
      { name:'🇬🇪 ge.movie', url: type==='tv' ? `https://em.filmx.my/play/?type=serial&id=${tmdbId}&name=serial&season=1&episode=1&lang=ka` : `https://em.filmx.my/play/?type=movie&id=${tmdbId}&lang=ka` },
      { name:'📺 adjaranetto', url: `https://adjaranetto.com/search?q=${encodeURIComponent(query)}` },
      { name:'🍿 chemikino', url: `https://chemikino.com/search?q=${encodeURIComponent(query)}` },
      { name:'🎬 ufasofilmebi.ge', url: `https://ufasofilmebi.ge/?s=${encodeURIComponent(query)}` },
      { name:'🐊 Croconet.cam', url: `https://croconet.cam/?s=${encodeURIComponent(query)}` },
      { name:'🔍 imovs.ge', url: `https://imovs.ge/search?q=${encodeURIComponent(query)}` },
      { name:'▶ VidSrc',     url: type==='tv' ? `https://vidsrc.to/embed/tv/${tmdbId}/1/1` : `https://vidsrc.to/embed/movie/${tmdbId}` },
      { name:'🌐 MultiEmbed',url: type==='tv' ? `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=1&e=1` : `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1` },
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
        
        // Trigger on-demand search inside the player instead of opening in a new tab!
        if (name.includes('adjaranetto') || name.includes('chemikino') || name.includes('ufasofilmebi') || name.includes('Croconet') || name.includes('imovs')) {
           const label = name.includes('adjaranetto') ? 'adjaranetto.com' : (name.includes('chemikino') ? 'chemikino.com' : (name.includes('ufasofilmebi') ? 'ufasofilmebi.ge' : (name.includes('Croconet') ? 'Croconet.cam' : 'imovs.ge')));
           const placeholderStream = {
             label: label,
             file: '',
             rawUrl: '',
             isPlaceholder: true,
             searchType: type === 'tv' ? 'series' : 'movie',
             season: 1,
             episode: 1
           };
           renderNative(el, [placeholderStream], null);
           return;
        }

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
    
    let result = null;
    for (const q of queries) {
      setStatus(`🔍 ძიება: ${q}...`);
      try {
        const r = await fetchWithTimeout(`${WORKER}/imovs?q=${encodeURIComponent(q)}`, { timeout: 6000 });
        const d = await r.json();
        if (d?.players?.length) { result = d.players; break; }
        if (d?.data?.length) { result = [{ streams: d.data }]; break; }
      } catch {}
    }
    
    if (info.tmdbId) {
      result = result || [{ streams: [] }];
      const geMovieStream = { isIframe: true, file: `https://em.filmx.my/play/?type=movie&id=${info.tmdbId}&lang=ka`, rawUrl: `https://em.filmx.my/play/?type=movie&id=${info.tmdbId}&lang=ka`, label: "ge.movie" };
      if (result.length > 0 && result[0].streams) {
        result[0].streams.unshift(geMovieStream);
      } else if (result.length > 0 && result[0].file) {
        result.unshift(geMovieStream);
      }
    }
    
    return result;
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
          return arr;
        }
      } catch {}
      return null;
    }

    const queries = buildQueries(info);
    
    let result = null;
    for (const q of queries) {
      setStatus(`🔍 სერიალის ძიება: ${q}...`);
      try {
        const r = await fetchWithTimeout(`${WORKER}/imovs-series?q=${encodeURIComponent(q)}`, { timeout: 6000 });
        const d = await r.json();
        if (d?.episodes?.length) { result = d.episodes; break; }
      } catch {}
      
      setStatus(`🔍 ანიმეს ძიება: ${q}...`);
      try {
        const ra = await fetchWithTimeout(`${WORKER}/animeb?q=${encodeURIComponent(q)}`, { timeout: 6000 });
        const da = await ra.json();
        if (da?.episodes?.length) { result = da.episodes; break; }
      } catch {}

      setStatus(`🔍 animetv.ge ძიება: ${q}...`);
      try {
        const rat = await fetchWithTimeout(`${WORKER}/animetv?q=${encodeURIComponent(q)}`, { timeout: 6000 });
        const dat = await rat.json();
        if (dat?.episodes?.length) { result = dat.episodes; break; }
      } catch {}
    }

    if (result && info.tmdbId) {
      result.forEach(ep => {
        const geMovieStream = { isIframe: true, file: `https://em.filmx.my/play/?type=serial&id=${info.tmdbId}&name=serial&season=${ep.season}&episode=${ep.episode}&lang=ka`, rawUrl: `https://em.filmx.my/play/?type=serial&id=${info.tmdbId}&name=serial&season=${ep.season}&episode=${ep.episode}&lang=ka`, label: "ge.movie" };
        if (ep.streams) {
          ep.streams.unshift(geMovieStream);
        } else {
          ep.streams = [geMovieStream];
        }
      });
    }

    return result;
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

    const tmdbId = info.tmdbId;
    const defaultStreams = [
      { label: 'ge.movie', file: `https://em.filmx.my/play/?type=movie&id=${tmdbId}&lang=ka`, rawUrl: `https://em.filmx.my/play/?type=movie&id=${tmdbId}&lang=ka`, isIframe: true },
      { label: 'adjaranetto.com', file: '', rawUrl: '', isPlaceholder: true, searchType: 'movie' },
      { label: 'chemikino.com', file: '', rawUrl: '', isPlaceholder: true, searchType: 'movie' },
      { label: 'ufasofilmebi.ge', file: '', rawUrl: '', isPlaceholder: true, searchType: 'movie' },
      { label: 'Croconet.cam', file: '', rawUrl: '', isPlaceholder: true, searchType: 'movie' },
      { label: 'imovs.ge', file: '', rawUrl: '', isPlaceholder: true, searchType: 'movie' },
      { label: 'VidSrc', file: `https://vidsrc.to/embed/movie/${tmdbId}`, rawUrl: `https://vidsrc.to/embed/movie/${tmdbId}`, isIframe: true },
      { label: 'MultiEmbed', file: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`, rawUrl: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`, isIframe: true }
    ];

    await renderNative(el, defaultStreams, null);
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
      showFallback(el, info, 'tv');
      return null;
    }

    if (info.seasons && onReady) {
      const episodes = [];
      info.seasons.forEach(s => {
        if (s.season_number === 0) return;
        for (let e = 1; e <= s.episode_count; e++) {
          const streams = [
            { label: 'ge.movie', file: `https://em.filmx.my/play/?type=serial&id=${info.tmdbId}&name=serial&season=${s.season_number}&episode=${e}&lang=ka`, rawUrl: `https://em.filmx.my/play/?type=serial&id=${info.tmdbId}&name=serial&season=${s.season_number}&episode=${e}&lang=ka`, isIframe: true },
            { label: 'adjaranetto.com', file: '', rawUrl: '', isPlaceholder: true, searchType: 'series', season: s.season_number, episode: e },
            { label: 'chemikino.com', file: '', rawUrl: '', isPlaceholder: true, searchType: 'series', season: s.season_number, episode: e },
            { label: 'ufasofilmebi.ge', file: '', rawUrl: '', isPlaceholder: true, searchType: 'series', season: s.season_number, episode: e },
            { label: 'Croconet.cam', file: '', rawUrl: '', isPlaceholder: true, searchType: 'series', season: s.season_number, episode: e },
            { label: 'imovs.ge', file: '', rawUrl: '', isPlaceholder: true, searchType: 'series', season: s.season_number, episode: e },
            { label: 'VidSrc', file: `https://vidsrc.to/embed/tv/${info.tmdbId}/${s.season_number}/${e}`, rawUrl: `https://vidsrc.to/embed/tv/${info.tmdbId}/${s.season_number}/${e}`, isIframe: true },
            { label: 'MultiEmbed', file: `https://multiembed.mov/?video_id=${info.tmdbId}&tmdb=1&s=${s.season_number}&e=${e}`, rawUrl: `https://multiembed.mov/?video_id=${info.tmdbId}&tmdb=1&s=${s.season_number}&e=${e}`, isIframe: true }
          ];
          
          episodes.push({
            season: s.season_number,
            episode: e,
            title: `სეზონი ${s.season_number} / სერია ${e}`,
            streams: streams
          });
        }
      });
      
      onReady(episodes);
      return { type: 'local', episodes };
    }

    showFallback(el, info, 'tv');
    return null;
  }

  // Load episode from worker episodes array
  async function loadEpisode(containerId, streams, onErrorFallback) {
    const el = document.getElementById(containerId);
    if (!el) return;
    await renderNative(el, streams, onErrorFallback);
  }

  function destroy() {
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
