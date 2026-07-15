// ============================================
//  MyFilm - Home View
// ============================================

const HomeView = (() => {

  let heroItems  = [];
  let heroIndex  = 0;
  let heroTimer  = null;
  let genreMap   = {};
  let cachedSections = {}; // { id: items[] } — ერთხელ ჩატვირთვის შემდეგ cache

  async function render(params) {
    stopTimer();

    const view = document.getElementById('view-home');
    view.innerHTML = `
      <section id="hero">
        <div id="hero-backdrop"></div>
        <div class="hero-content">
          <div class="hero-badge"   id="hero-badge">🎬 ფილმი</div>
          <h1  class="hero-title"   id="hero-title">იტვირთება...</h1>
          <div class="hero-meta"    id="hero-meta"></div>
          <div class="hero-genres"  id="hero-genres"></div>
          <p   class="hero-overview" id="hero-overview"></p>
          <div class="hero-buttons">
            <button class="btn-primary"   id="hero-watch">▶ ყურება</button>
            <button class="btn-secondary" id="hero-info">ℹ️ ინფო</button>
          </div>
        </div>
        <div class="hero-dots" id="hero-dots"></div>
      </section>
      <main id="home-sections"></main>`;

    // Genre map + trending (both cached after first load)
    const [gMap, trendData] = await Promise.all([
      API.genres(),
      API.trending(),
    ]);

    genreMap  = gMap  || {};
    heroItems = (trendData?.results || []).filter(i => i.backdrop_path).slice(0, 8);

    if (heroItems.length) {
      renderDots();
      showHero(heroIndex < heroItems.length ? heroIndex : 0);
      startTimer();
    }

    buildSections();
    fillSections();
  }

  // ---- HERO ----
  function showHero(idx) {
    heroIndex = idx;
    const item = heroItems[idx];
    if (!item) return;

    const type  = item.media_type || (item.first_air_date ? 'tv' : 'movie');
    const title = item.title || item.name || '';
    const year  = (item.release_date || item.first_air_date || '').slice(0, 4);
    const rtg   = parseFloat(item.vote_average || 0).toFixed(1);

    const bd = document.getElementById('hero-backdrop');
    if (bd) {
      bd.style.opacity = '0';
      setTimeout(() => {
        bd.style.backgroundImage = `url(${CONFIG.TMDB_IMAGE_BASE}/w1280${item.backdrop_path})`;
        bd.style.opacity = '1';
      }, 160);
    }

    setTxt('hero-title',    title);
    setTxt('hero-badge',    type === 'tv' ? '📺 სერიალი' : '🎬 ფილმი');
    setTxt('hero-overview', item.overview || 'სიუჟეტი ხელმისაწვდომი არ არის.');

    setHtml('hero-meta', `
      ${parseFloat(rtg) > 0 ? `<span class="hero-meta-item"><span class="star">⭐</span><span class="rating-val">${rtg}</span></span>` : ''}
      ${year ? `<span class="hero-meta-item"><span class="year">${year}</span></span>` : ''}
      ${item.vote_count ? `<span class="hero-meta-item">${UI.formatVotes(item.vote_count)} ხმა</span>` : ''}`);

    setHtml('hero-genres',
      (item.genre_ids || []).slice(0, 4)
        .map(id => genreMap[id] ? `<span class="hero-genre-tag">${genreMap[id]}</span>` : '')
        .join(''));

    // Buttons — clone to remove old listeners
    replBtn('hero-watch', () => UI.goToDetail(item.id, type));
    replBtn('hero-info',  () => UI.goToDetail(item.id, type));

    document.querySelectorAll('.hero-dot').forEach((d, i) =>
      d.classList.toggle('active', i === idx));
  }

  function renderDots() {
    const c = document.getElementById('hero-dots');
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

  // ---- SECTIONS ----
  function buildSections() {
    const wrap = document.getElementById('home-sections');
    if (!wrap) return;
    wrap.innerHTML = '';

    CONFIG.HOME_SECTIONS.forEach(sec => {
      // Use cached items if available, else show skeletons
      const items = cachedSections[sec.id] || null;
      wrap.appendChild(UI.buildSection(sec.id, sec.title, items));
    });
  }

  async function fillSections() {
    await Promise.allSettled(
      CONFIG.HOME_SECTIONS.map(async sec => {
        // Already cached → already shown in buildSections
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

  // ---- Helpers ----
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

})();
