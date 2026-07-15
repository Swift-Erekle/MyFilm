// ============================================
//  MyFilm - Browse View (Reusable)
// ============================================

const BrowseView = (() => {

  return {
    create: function(viewId, sectionKey, heroEndpoint, defaultBadge) {
      let heroItems  = [];
      let heroIndex  = 0;
      let heroTimer  = null;
      let genreMap   = {};
      let cachedSections = {}; 

      async function render(params) {
        stopTimer();

        const view = document.getElementById(viewId);
        if (!view) return;

        view.innerHTML = `
          <section id="${viewId}-hero" class="hero-section">
            <div id="${viewId}-hero-backdrop" class="hero-backdrop"></div>
            <div class="hero-content">
              <div class="hero-badge"   id="${viewId}-hero-badge">${defaultBadge}</div>
              <h1  class="hero-title"   id="${viewId}-hero-title">იტვირთება...</h1>
              <div class="hero-meta"    id="${viewId}-hero-meta"></div>
              <div class="hero-genres"  id="${viewId}-hero-genres"></div>
              <p   class="hero-overview" id="${viewId}-hero-overview"></p>
              <div class="hero-buttons">
                <button class="btn-primary"   id="${viewId}-hero-watch">▶ ყურება</button>
                <button class="btn-secondary" id="${viewId}-hero-info">ℹ️ ინფო</button>
              </div>
            </div>
            <div class="hero-dots" id="${viewId}-hero-dots"></div>
          </section>
          <main id="${viewId}-sections" class="home-sections"></main>`;

        // Ensure genres are loaded
        const [gMap, heroData] = await Promise.all([
          API.genres(),
          API.section(heroEndpoint)
        ]);

        genreMap  = gMap || {};
        heroItems = (heroData?.results || []).filter(i => i.backdrop_path).slice(0, 8);

        if (heroItems.length) {
          renderDots();
          showHero(heroIndex < heroItems.length ? heroIndex : 0);
          startTimer();
        }

        buildSections();
        fillSections();
      }

      function showHero(idx) {
        heroIndex = idx;
        const item = heroItems[idx];
        if (!item) return;

        const type  = item.media_type || (item.first_air_date ? 'tv' : 'movie');
        const title = item.title || item.name || '';
        const year  = (item.release_date || item.first_air_date || '').slice(0, 4);
        const rtg   = parseFloat(item.vote_average || 0).toFixed(1);

        const bd = document.getElementById(`${viewId}-hero-backdrop`);
        if (bd) {
          bd.style.opacity = '0';
          setTimeout(() => {
            const bgUrl = item.backdrop_path 
              ? `${CONFIG.TMDB_IMAGE_BASE}/w1280${item.backdrop_path}`
              : (item.poster_path?.startsWith('http') ? item.poster_path : `${CONFIG.TMDB_IMAGE_BASE}/w1280${item.poster_path}`);
            bd.style.backgroundImage = `url(${bgUrl})`;
            bd.style.opacity = '1';
          }, 160);
        }

        setTxt(`${viewId}-hero-title`,    title);
        
        let badgeTxt = defaultBadge;
        if (type === 'tv') badgeTxt = '📺 სერიალი';
        if (type === 'movie') badgeTxt = '🎬 ფილმი';
        setTxt(`${viewId}-hero-badge`,    badgeTxt);
        
        setTxt(`${viewId}-hero-overview`, item.overview || 'სიუჟეტი ხელმისაწვდომი არ არის.');

        setHtml(`${viewId}-hero-meta`, `
          ${parseFloat(rtg) > 0 ? `<span class="hero-meta-item"><span class="star">⭐</span><span class="rating-val">${rtg}</span></span>` : ''}
          ${year ? `<span class="hero-meta-item"><span class="year">${year}</span></span>` : ''}
          ${item.vote_count ? `<span class="hero-meta-item">${UI.formatVotes(item.vote_count)} ხმა</span>` : ''}`);

        setHtml(`${viewId}-hero-genres`,
          (item.genre_ids || []).slice(0, 4)
            .map(id => genreMap[id] ? `<span class="hero-genre-tag">${genreMap[id]}</span>` : '')
            .join(''));

        replBtn(`${viewId}-hero-watch`, () => UI.goToDetail(item.id, type));
        replBtn(`${viewId}-hero-info`,  () => UI.goToDetail(item.id, type));

        document.querySelectorAll(`#${viewId}-hero-dots .hero-dot`).forEach((d, i) =>
          d.classList.toggle('active', i === idx));
      }

      function renderDots() {
        const c = document.getElementById(`${viewId}-hero-dots`);
        if (!c) return;
        c.innerHTML = '';
        heroItems.forEach((_, i) => {
          const d = document.createElement('button');
          d.className = `hero-dot${i === 0 ? ' active' : ''}`;
          d.addEventListener('click', () => { stopTimer(); showHero(i); startTimer(); });
          c.appendChild(d);
        });
      }

      function startTimer() {
        if (heroTimer) clearInterval(heroTimer);
        heroTimer = setInterval(() => showHero((heroIndex + 1) % heroItems.length), 6000);
      }
      function stopTimer() { if (heroTimer) { clearInterval(heroTimer); heroTimer = null; } }

      function buildSections() {
        const wrap = document.getElementById(`${viewId}-sections`);
        if (!wrap) return;
        wrap.innerHTML = '';

        const sections = CONFIG[sectionKey] || [];
        sections.forEach(sec => {
          const items = cachedSections[sec.id] || null;
          wrap.appendChild(UI.buildSection(sec.id, sec.title, items));
        });
      }

      async function fillSections() {
        const sections = CONFIG[sectionKey] || [];
        await Promise.allSettled(
          sections.map(async sec => {
            if (cachedSections[sec.id]) return;

            try {
              const data = await API.section(sec.endpoint);
              if (data?.results) {
                const items = data.results.filter(i => i.poster_path);
                cachedSections[sec.id] = items;
                UI.fillRow(sec.id, items);
              }
            } catch (e) {
              console.warn(`Section ${sec.id}:`, e);
            }
          })
        );
      }

      function setTxt(id, v)  { const e = document.getElementById(id); if (e) e.textContent = v; }
      function setHtml(id, v) { const e = document.getElementById(id); if (e) e.innerHTML   = v; }
      function replBtn(id, fn) {
        const old = document.getElementById(id);
        if (!old) return;
        const neo = old.cloneNode(true);
        neo.addEventListener('click', fn);
        old.parentNode.replaceChild(neo, old);
      }

      return { render };
    }
  };

})();