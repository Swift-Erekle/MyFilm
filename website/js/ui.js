// ============================================
//  MyFilm - Shared UI Utilities
// ============================================

const UI = (() => {

  function toast(msg, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = '0.3s';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  // ---- NAVIGATE — uses hash router, NO page reload ----
  function goToDetail(id, type) {
    Router.go(`/movie/${id}/${type}`);
  }

  // ---- Build Movie Card ----
  function buildCard(item) {
    const type      = item.media_type || (item.first_air_date ? 'tv' : 'movie');
    const titleText = item.title || item.name || 'უცნობი';
    const year      = (item.release_date || item.first_air_date || '').slice(0, 4);
    const rating    = parseFloat(item.vote_average || 0).toFixed(1);
    const posterUrl = item.poster_path
      ? (item.poster_path.startsWith('http') ? item.poster_path : `${CONFIG.TMDB_IMAGE_BASE}/${CONFIG.IMAGE.POSTER_MD}${item.poster_path}`)
      : null;
    const typeLabel = type === 'tv' ? 'სერიალი' : 'ფილმი';

    const card = document.createElement('div');
    card.className = 'movie-card';
    card.dataset.id   = item.id;
    card.dataset.type = type;

    card.innerHTML = `
      <div class="movie-card-poster">
        ${posterUrl
          ? `<img src="${posterUrl}" alt="${esc(titleText)}" loading="lazy">`
          : `<div class="no-poster-placeholder">🎬</div>`}
        <div class="card-type-badge">${typeLabel}</div>
        ${parseFloat(rating) > 0 ? `<div class="card-rating-badge">⭐ ${rating}</div>` : ''}
        <div class="movie-card-overlay">
          <div class="card-play-btn">▶</div>
          <div class="card-overlay-title">${esc(titleText)}</div>
          <div class="card-overlay-meta">${year} • ${typeLabel}</div>
        </div>
      </div>
      <div class="movie-card-info">
        <div class="movie-card-title">${esc(titleText)}</div>
        <div class="movie-card-year">${year}</div>
      </div>`;

    // ONE click handler — always goes to detail
    card.addEventListener('click', () => goToDetail(item.id, type));

    return card;
  }

  // ---- Skeletons ----
  function buildSkeletons(count = 6) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'skeleton-card';
      el.innerHTML = `
        <div class="skeleton skeleton-poster"></div>
        <div class="skeleton skeleton-text" style="width:80%;margin-top:10px"></div>
        <div class="skeleton skeleton-text short"></div>`;
      frag.appendChild(el);
    }
    return frag;
  }

  // ---- Horizontal Row Section ----
  function buildSection(id, title, items) {
    const section = document.createElement('div');
    section.className = 'content-section';
    section.id = `section-${id}`;

    section.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${title}</h2>
      </div>
      <div class="cards-row-wrap">
        <button class="scroll-btn left">‹</button>
        <div class="cards-row" id="row-${id}"></div>
        <button class="scroll-btn right">›</button>
      </div>`;

    const row    = section.querySelector('.cards-row');
    const leftB  = section.querySelector('.scroll-btn.left');
    const rightB = section.querySelector('.scroll-btn.right');

    leftB.addEventListener('click',  () => row.scrollBy({ left: -640, behavior: 'smooth' }));
    rightB.addEventListener('click', () => row.scrollBy({ left: 640,  behavior: 'smooth' }));

    if (items && items.length) {
      items.forEach(i => row.appendChild(buildCard(i)));
    } else {
      row.appendChild(buildSkeletons(8));
    }

    return section;
  }

  function fillRow(id, items) {
    const row = document.getElementById(`row-${id}`);
    if (!row) return;
    row.innerHTML = '';
    items.forEach(i => row.appendChild(buildCard(i)));
  }

  // ---- Navbar scroll ----
  function initNavbar() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;
    const fn = () => navbar.classList.toggle('scrolled', window.scrollY > 40);
    window.addEventListener('scroll', fn, { passive: true });
    fn();

    // Nav search
    const inp = document.getElementById('nav-search-input');
    if (inp) {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' && inp.value.trim()) {
          inp.value = '';
          Router.go(`/search/${encodeURIComponent(inp.value.trim())}`);
        }
      });
      inp.addEventListener('input', e => {
        // live search trigger
        const q = inp.value.trim();
        if (q.length >= 2) {
          clearTimeout(inp._t);
          inp._t = setTimeout(() => Router.go(`/search/${encodeURIComponent(q)}`), 400);
        }
      });
    }

    // Nav links
    document.getElementById('nav-home')?.addEventListener('click', e => { e.preventDefault(); Router.go('/home'); });
    document.getElementById('nav-movies')?.addEventListener('click', e => { e.preventDefault(); Router.go('/search-movies'); });
    document.getElementById('nav-tv')?.addEventListener('click', e => { e.preventDefault(); Router.go('/search-tv'); });
    document.getElementById('nav-search')?.addEventListener('click', e => { e.preventDefault(); Router.go('/search'); });
  }

  // ---- Format runtime ----
  function formatRuntime(min) {
    if (!min) return '';
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h}სთ ${m}წთ` : `${m}წთ`;
  }

  function formatVotes(n) {
    if (!n) return '';
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n/1000).toFixed(1) + 'K';
    return String(n);
  }

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { toast, goToDetail, buildCard, buildSkeletons, buildSection, fillRow, initNavbar, formatRuntime, formatVotes, esc };

})();
