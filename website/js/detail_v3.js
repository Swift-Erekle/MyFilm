// ============================================
//  MyFilm — Detail View
//  ფილმი/სერიალი: ინფო + Georgian player + burger
// ============================================

const DetailView = (() => {

  // State
  let item           = null;
  let tmdbId         = null;
  let mediaType      = null;
  let allSeasons     = [];
  let workerEpisodes = [];   // [{season, episode, streams}]
  let currentEpIdx   = 0;
  let outsideClickHandler = null;

  function cleanup() {
    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler);
      outsideClickHandler = null;
    }
  }

  // ---- ENTRY ----
  async function render(params) {
    cleanup();
    const id   = params[0];
    const type = params[1] || 'movie';

    Player.destroy();

    // Reset if new item
    if (tmdbId !== id || mediaType !== type) {
      tmdbId         = id;
      mediaType      = type;
      item           = null;
      allSeasons     = [];
      workerEpisodes = [];
      currentEpIdx   = 0;
    }

    const view = document.getElementById('view-movie');
    view.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:90vh">
        <div class="spinner"></div>
      </div>`;

    // Fetch TMDB info (resolve real tmdbId if custom)
    let realTmdbId = id;
    let customMatch = null;
    if (typeof CUSTOM_ANIMES !== 'undefined') {
      customMatch = CUSTOM_ANIMES.find(a => String(a.id) === String(id));
      if (customMatch && customMatch.tmdb_id) {
        realTmdbId = customMatch.tmdb_id;
      }
    }

    item = await API.detail(realTmdbId, type);

    // Override names with our exact animetv.ge matches if it's a custom anime!
    if (item && customMatch) {
      item.name = customMatch.name;
      item.title = customMatch.name;
      item.original_name = customMatch.original_name;
      item.original_title = customMatch.original_name;
    }

    if (!item || item.success === false) {
      if (customMatch) {
        item = {
          title: customMatch.name,
          name: customMatch.name,
          original_title: customMatch.original_name,
          original_name: customMatch.original_name,
          poster_path: customMatch.poster_path || '',
          backdrop_path: '',
          overview: "ინფორმაცია მიუწვდომელია (ანიმე TMDB-ზე არ მოიძებნა)",
          release_date: customMatch.year ? `${customMatch.year}-01-01` : '',
          first_air_date: customMatch.year ? `${customMatch.year}-01-01` : '',
          vote_average: 0,
          genres: [{name: 'ანიმე'}],
          seasons: [{season_number: 1}],
          number_of_seasons: 1,
        };
      } else {
        view.innerHTML = `
          <div class="detail-error">
            <div style="font-size:3rem">😕</div>
            <h2>ვერ ჩაიტვირთა</h2>
            <button class="btn-primary" onclick="Router.go('/home')">← მთავარი</button>
          </div>`;
        return;
      }
    }

    document.title = `${item.title || item.name} — MyFilm`;

    if (type === 'tv') {
      allSeasons = (item.seasons || []).filter(s => s.season_number > 0);
    }

    rebuildView();
  }

  // ---- BUILD VIEW ----
  function rebuildView() {
    const view = document.getElementById('view-movie');

    const title    = item.title || item.name || '';
    const origTitle= item.original_title || item.original_name || '';
    const year     = (item.release_date || item.first_air_date || '').slice(0, 4);
    const rating   = parseFloat(item.vote_average || 0).toFixed(1);
    const runtime  = mediaType === 'movie' ? UI.formatRuntime(item.runtime) : '';
    const seasonsN = mediaType === 'tv' && item.number_of_seasons ? `${item.number_of_seasons} სეზ.` : '';
    const genres   = (item.genres || []).map(g => `<span class="detail-genre-tag">${g.name}</span>`).join('');
    const backdrop = item.backdrop_path ? (item.backdrop_path.startsWith('http') ? item.backdrop_path : `${CONFIG.TMDB_IMAGE_BASE}/w1280${item.backdrop_path}`) : '';
    const poster   = item.poster_path   ? (item.poster_path.startsWith('http') ? item.poster_path : `${CONFIG.TMDB_IMAGE_BASE}/w500${item.poster_path}`) : '';
    const overview = item.overview || '';

    const similarItems = (item.similar?.results || [])
      .filter(i => i.poster_path)
      .map(i => ({ ...i, media_type: mediaType }));

    view.innerHTML = `
      <!-- HERO -->
      <div class="detail-hero">
        <div class="detail-backdrop" style="background-image:url('${backdrop}')"></div>
        <div class="detail-hero-content">
          ${poster ? `<div class="detail-poster"><img src="${poster}" alt="${UI.esc(title)}" loading="lazy"></div>` : ''}
          <div class="detail-info">
            <h1 class="detail-title">${UI.esc(title)}</h1>
            ${origTitle && origTitle !== title ? `<div class="detail-orig-title">${UI.esc(origTitle)}</div>` : ''}
            <div class="detail-meta-row">
              ${parseFloat(rating) > 0 ? `
                <div class="detail-meta-item"><span class="star-icon">⭐</span><span class="val">${rating}</span></div>
                <div class="detail-meta-sep"></div>` : ''}
              ${year     ? `<div class="detail-meta-item"><span class="val">${year}</span></div>` : ''}
              ${runtime  ? `<div class="detail-meta-sep"></div><div class="detail-meta-item"><span class="val">${runtime}</span></div>` : ''}
              ${seasonsN ? `<div class="detail-meta-sep"></div><div class="detail-meta-item"><span class="val">${seasonsN}</span></div>` : ''}
              ${item.vote_count ? `<div class="detail-meta-sep"></div><div class="detail-meta-item">${UI.formatVotes(item.vote_count)} ხმა</div>` : ''}
            </div>
            <div class="detail-genres">${genres}</div>
            ${overview ? `<p class="detail-overview">${UI.esc(overview)}</p>` : ''}
            <div class="detail-actions">
              <button class="btn-primary" id="btn-scroll-player">▶ ყურება</button>
              <button class="btn-secondary" id="btn-back">← მთავარი</button>
            </div>
          </div>
        </div>
      </div>

      <!-- BODY -->
      <div class="detail-body">

        <!-- PLAYER -->
        <section class="player-section" id="player-section">
          <h2 class="player-section-title">
            ${mediaType === 'tv' ? '📺 სერიალის ყურება (ქართულად)' : '🎬 ფილმის ყურება (ქართულად)'}
          </h2>

          <div class="player-wrapper" id="player-wrapper">
            <div class="player-container" id="player-container">
              <div style="display:flex;align-items:center;justify-content:center;height:100%">
                <div class="spinner"></div>
              </div>
            </div>

            ${mediaType === 'tv' ? `
            <!-- TV BURGER -->
            <div class="player-burger-overlay" id="burger-overlay">
              <button class="burger-trigger" id="burger-trigger" title="სეზონები / სერიები">
                <span></span><span></span><span></span>
              </button>
              <div class="burger-panel" id="burger-panel">
                <div class="burger-panel-header">
                  <span>სეზონები &amp; სერიები</span>
                  <button class="burger-close" id="burger-close">✕</button>
                </div>
                <div class="burger-loading" id="burger-loading" style="padding:20px;text-align:center;color:#555;font-size:0.82rem">
                  <div class="spinner" style="width:24px;height:24px;margin:0 auto 8px"></div>
                  სერიები იტვირთება...
                </div>
                <div class="burger-seasons"  id="burger-seasons"  style="display:none"></div>
                <div class="burger-episodes" id="burger-episodes" style="display:none"></div>
              </div>
            </div>` : ''}
          </div>

          ${mediaType === 'tv' ? `<div class="now-playing-label" id="now-playing-label">▶ ქართული წყარო იტვირთება...</div>` : ''}
        </section>

        <!-- SIMILAR -->
        ${similarItems.length ? `<section class="similar-section" id="similar-section"></section>` : ''}

      </div>`;

    // Wire buttons
    document.getElementById('btn-scroll-player')?.addEventListener('click', () => {
      document.getElementById('player-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('btn-back')?.addEventListener('click', () => Router.go('/home'));

    const customObj = (typeof CUSTOM_ANIMES !== 'undefined') ? CUSTOM_ANIMES.find(a => String(a.id) === String(tmdbId)) : null;

    // Build info object for player
    const playerInfo = {
      title:     item.title || item.name || '',
      origTitle: item.original_title || item.original_name || '',
      year:      year,
      tmdbId:    tmdbId,
      type:      mediaType,
      imdbId:    item.external_ids?.imdb_id || item.imdb_id || null,
      animetv_url: customObj ? customObj.animetv_url : null,
      seasons:   item.seasons || null,
    };

    if (mediaType === 'tv') {
      initBurger();
      Player.loadSeries('player-container', playerInfo, (episodes) => {
        if (episodes) {
          workerEpisodes = episodes;
          buildBurgerFromEps(episodes);
          updateNowPlaying(0);
          
          if (episodes.overview) {
            const overviewEl = document.querySelector('.detail-overview');
            if (overviewEl) overviewEl.textContent = episodes.overview;
          }
          
          // Trigger first episode click to enable fallback logic
          const firstBtn = document.querySelector('.burger-ep-btn');
          if (firstBtn) firstBtn.click();
        }
      });
    } else {
      Player.loadMovie('player-container', playerInfo);
    }

    // Similar section
    if (similarItems.length) {
      const sec = UI.buildSection('similar', '🎯 მსგავსი კონტენტი', similarItems);
      document.getElementById('similar-section')?.appendChild(sec);
    }
  }

  // ---- NOW PLAYING LABEL ----
  function updateNowPlaying(epIdx) {
    const lbl = document.getElementById('now-playing-label');
    if (!lbl || !workerEpisodes.length) return;
    const ep = workerEpisodes[epIdx];
    if (ep) {
      lbl.textContent = `▶  სეზონი ${ep.season}  •  სერია ${ep.episode}`;
    }
  }

  // ---- BURGER MENU ----
  function initBurger() {
    const trigger  = document.getElementById('burger-trigger');
    const panel    = document.getElementById('burger-panel');
    const closeBtn = document.getElementById('burger-close');

    trigger?.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.toggle('open');
    });
    closeBtn?.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.remove('open');
    });
    outsideClickHandler = e => {
      if (!document.getElementById('burger-overlay')?.contains(e.target)) {
        panel?.classList.remove('open');
      }
    };
    document.addEventListener('click', outsideClickHandler);
  }

  function buildBurgerFromEps(episodes) {
    const loading  = document.getElementById('burger-loading');
    const seasonsEl = document.getElementById('burger-seasons');
    const epsEl    = document.getElementById('burger-episodes');
    if (!seasonsEl || !epsEl) return;

    if (loading) loading.style.display = 'none';
    seasonsEl.style.display = '';
    epsEl.style.display = '';

    // Group by season
    const bySeasonMap = {};
    episodes.forEach((ep, idx) => {
      if (!bySeasonMap[ep.season]) bySeasonMap[ep.season] = [];
      bySeasonMap[ep.season].push({ ...ep, _idx: idx });
    });

    const seasonNums = Object.keys(bySeasonMap).map(Number).sort((a,b) => a-b);
    let activeSeason = seasonNums[0];

    function renderSeasonBtns() {
      seasonsEl.innerHTML = '';
      if (seasonNums.length <= 1) {
        seasonsEl.style.display = 'none';
        return;
      }
      seasonsEl.style.display = '';
      seasonNums.forEach(s => {
        const btn = document.createElement('button');
        btn.className = `burger-season-btn${s === activeSeason ? ' active' : ''}`;
        btn.textContent = `სეზონი ${s}`;
        btn.addEventListener('click', e => {
          e.stopPropagation();
          activeSeason = s;
          renderSeasonBtns();
          renderEpBtns();
        });
        seasonsEl.appendChild(btn);
      });
    }

    function renderEpBtns() {
      epsEl.innerHTML = '';
      const eps = bySeasonMap[activeSeason] || [];
      eps.forEach(ep => {
        const btn = document.createElement('button');
        btn.className = `burger-ep-btn${ep._idx === currentEpIdx ? ' active' : ''}`;
        btn.__epIdx = ep._idx;
        
        const isAlt = ep.playerIndex > 1 || (ep.title && ep.title.includes('ფლეიერი'));
        const mainText = isAlt ? `ფლეიერი ${ep.playerIndex || 2}` : `▶ სერია ${ep.episode}`;
        const style = isAlt ? `padding-left: 20px; font-weight: normal; font-size: 0.85rem;` : ``;

        btn.innerHTML = `
          <span class="ep-num" style="${style}">${mainText}</span>
          <span class="ep-title" style="display:none"></span>`;
          
        btn.addEventListener('click', e => {
          if (e) e.stopPropagation();
          currentEpIdx = ep._idx;
          epsEl.querySelectorAll('.burger-ep-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          
          const playNext = async () => {
             const current = workerEpisodes[currentEpIdx];
             const nextEp = workerEpisodes.find(x => x.season === current.season && x.episode === current.episode && x.playerIndex > current.playerIndex);
             if (nextEp) {
                 const targetBtn = Array.from(epsEl.querySelectorAll('.burger-ep-btn')).find(b => b.__epIdx === nextEp._idx);
                 if (targetBtn) {
                     targetBtn.click();
                 } else {
                     currentEpIdx = nextEp._idx;
                     Player.loadEpisode('player-container', nextEp.streams, playNext, nextEp);
                     updateNowPlaying(currentEpIdx);
                 }
                 return true; // handled
             }
             return false; // no more players
          };

          Player.loadEpisode('player-container', ep.streams, playNext, ep);
          updateNowPlaying(ep._idx);
          document.getElementById('burger-panel')?.classList.remove('open');
          
          if (e) {
            document.getElementById('player-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        epsEl.appendChild(btn);
      });
    }

    renderSeasonBtns();
    renderEpBtns();
  }

  // Lumex has been removed

  return { render, cleanup };

})();
