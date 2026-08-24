// ============================================
//  MyFilm - Search View
// ============================================

const SearchView = (() => {

  let currentFilter = 'all';
  let searchTimer   = null;
  let allResults    = [];
  let queryText     = '';
  let requestVersion = 0;

  const transliterationMap = {
    ა:'a', ბ:'b', გ:'g', დ:'d', ე:'e', ვ:'v', ზ:'z', თ:'t', ი:'i', კ:'k', ლ:'l', მ:'m', ნ:'n', ო:'o', პ:'p', ჟ:'zh', რ:'r', ს:'s', ტ:'t', უ:'u', ფ:'f', ქ:'q', ღ:'gh', ყ:'y', შ:'sh', ჩ:'ch', ც:'ts', ძ:'dz', წ:'ts', ჭ:'ch', ხ:'kh', ჯ:'j', ჰ:'h'
  };

  function transliterate(value) {
    return String(value || '').split('').map(char => transliterationMap[char.toLowerCase()] || char).join('');
  }

  function safeDecode(value) {
    try { return decodeURIComponent(value); }
    catch { return value; }
  }

  function isAnime(item) {
    if (item.is_custom) return true;
    const isJa = item.original_language === 'ja';
    const hasAnimation = (item.genre_ids || []).includes(16);
    const isJapan = (item.origin_country || []).includes('JP');
    return (isJa && hasAnimation) || (isJapan && hasAnimation);
  }

  async function render(params) {
    requestVersion += 1;
    const rawParam = params[0] ? safeDecode(params[0]) : '';
    let initQuery = rawParam;
    queryText = initQuery;
    currentFilter = 'all';

    const view = document.getElementById('view-search');
    view.innerHTML = `
      <div class="search-page-wrap">
        <div class="search-hero">
          <h1>🔍 ძიება</h1>
          <p>იპოვე შენი საყვარელი ფილმი ან სერიალი</p>
          <div class="search-input-wrap">
            <span class="search-icon-big">🔍</span>
            <input id="search-input" type="search" placeholder="ჩაწერე სახელი..." autocomplete="off" autofocus>
          </div>
          <div class="search-filters" style="margin-top: 15px;">
            <button class="filter-btn active" data-filter="all">🎬 ყველა</button>
            <button class="filter-btn" data-filter="movie">🎥 ფილმები</button>
            <button class="filter-btn" data-filter="tv">📺 სერიალები</button>
            <button class="filter-btn" data-filter="anime">🌸 ანიმე</button>
          </div>
        </div>
        <div class="search-results-wrap">
          <p class="search-results-info" id="search-info"></p>
          <div class="results-grid" id="results-grid"></div>
        </div>
      </div>`;

    // Pre-fill input
    const input = document.getElementById('search-input');
    if (initQuery) input.value = initQuery;

    // Filter click events
    const filterBtns = view.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        applyFilterAndRender();
      });
    });

    // Live search
    input.addEventListener('input', () => {
      const q = input.value.trim();
      queryText = q;
      clearTimeout(searchTimer);
      if (!q) { allResults = []; showTrending(); return; }
      showSkeletons();
      searchTimer = setTimeout(() => doSearch(q), 380);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { input.value = ''; queryText = ''; allResults = []; showTrending(); }
    });

    // Load initial state
    if (initQuery) { doSearch(initQuery); }
    else           { showTrending(); }
  }

  async function doSearch(query) {
    const version = ++requestVersion;
    showSkeletons('ძებნა...');
    
    // 1. Search locally in CUSTOM_ANIMES
    const qLower = query.toLowerCase();
    const customMatches = (typeof CUSTOM_ANIMES !== 'undefined' ? CUSTOM_ANIMES : []).filter(c => {
       const n1 = (c.name || '').toLowerCase();
       const n2 = (c.original_name || '').toLowerCase();
       return n1.includes(qLower) || n2.includes(qLower);
    }).map(c => ({
       id: c.tmdb_id || c.id,
       title: c.name,
       name: c.name,
       original_name: c.original_name,
       poster_path: c.poster_path ? c.poster_path.replace(CONFIG.TMDB_IMAGE_BASE + '/w342', '') : null,
       media_type: c.media_type || 'tv',
       first_air_date: c.year ? c.year + "-01-01" : null,
       vote_average: 0,
       is_custom: true
    }));

    // 2. Search in TMDB
    const latinQuery = transliterate(query);
    const queries = [...new Set([query, latinQuery].filter(Boolean))];
    const responses = await Promise.all(queries.map(value => API.search(value)));
    if (version !== requestVersion || queryText !== query) return;
    const tmdbResults = responses.flatMap(data => data?.results || []).filter(i => i.poster_path && i.media_type !== 'person');
    
    // 3. Merge, avoiding duplicates by id
    allResults = [];
    const seenIds = new Set();
    
    for (const c of customMatches) {
       allResults.push(c);
       if (c.id) seenIds.add(String(c.id));
    }
    for (const r of tmdbResults) {
       if (!seenIds.has(String(r.id))) {
          allResults.push(r);
          seenIds.add(String(r.id));
       }
    }

    applyFilterAndRender();
  }

  async function showTrending() {
    const version = ++requestVersion;
    showSkeletons('🔥 ტრენდული');
    const data = await API.trending();
    if (version !== requestVersion || queryText) return;
    allResults = (data?.results || []).filter(i => i.poster_path);
    applyFilterAndRender();
  }

  function applyFilterAndRender() {
    let filtered = [];
    if (currentFilter === 'all') {
      filtered = allResults;
    } else if (currentFilter === 'movie') {
      filtered = allResults.filter(item => item.media_type === 'movie' && !isAnime(item));
    } else if (currentFilter === 'tv') {
      filtered = allResults.filter(item => item.media_type === 'tv' && !isAnime(item));
    } else if (currentFilter === 'anime') {
      filtered = allResults.filter(item => isAnime(item));
    }

    const titlePrefix = queryText ? `მოიძებნა ${filtered.length} შედეგი — "${queryText}"` : '🔥 ტრენდული ახლა';
    renderResults(filtered, titlePrefix);
  }

  function renderResults(items, infoText) {
    const grid = document.getElementById('results-grid');
    const info = document.getElementById('search-info');
    if (!grid || !info) return;

    info.textContent = infoText;
    grid.innerHTML = '';

    if (!items.length) {
      grid.innerHTML = `
        <div class="no-results" style="grid-column:1/-1">
          <div class="nr-icon">🎬</div>
          <h3>ვერ მოიძებნა</h3>
          <p>სცადე სხვა ფილტრი ან სიტყვა</p>
        </div>`;
      return;
    }

    items.forEach(item => grid.appendChild(UI.buildCard(item)));
  }

  function showSkeletons(infoText = '') {
    const grid = document.getElementById('results-grid');
    const info = document.getElementById('search-info');
    if (!grid) return;
    if (info) info.textContent = infoText;
    grid.innerHTML = '';
    for (let i = 0; i < 12; i++) {
      const el = document.createElement('div');
      el.className = 'skeleton-card';
      el.innerHTML = `
        <div class="skeleton skeleton-poster" style="height:240px"></div>
        <div class="skeleton skeleton-text" style="width:80%;margin-top:10px"></div>
        <div class="skeleton skeleton-text short"></div>`;
      grid.appendChild(el);
    }
  }

  return { render };

})();
