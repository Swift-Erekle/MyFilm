// ============================================
//  MyFilm - TMDB API
// ============================================

const API = (() => {

  const _cache = new Map();

  async function req(endpoint, extra = {}) {
    const url = new URL(CONFIG.TMDB_BASE_URL + endpoint);
    url.searchParams.set('api_key', CONFIG.TMDB_API_KEY);
    url.searchParams.set('language', CONFIG.TMDB_LANGUAGE);
    Object.entries(extra).forEach(([k,v]) => url.searchParams.set(k, v));

    const key = url.toString();
    if (_cache.has(key)) return _cache.get(key);

    function cleanData(data) {
      if (!data) return data;
      const cjkRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\uFAFF\uFF66-\uFF9F]/;
      const customAnimes = (typeof CUSTOM_ANIMES !== 'undefined') ? CUSTOM_ANIMES : [];

      const cleanItem = (i) => {
        if (!i) return;
        
        // Merge from CUSTOM_ANIMES
        const custom = customAnimes.find(c => String(c.tmdb_id) === String(i.id));
        if (custom) {
           i.name = custom.name;
           i.title = custom.name;
           if (custom.poster_path && !custom.poster_path.startsWith('http')) {
              i.poster_path = custom.poster_path; // if relative path
           }
        }

        if (i.original_name && cjkRegex.test(i.original_name)) i.original_name = i.name || '';
        if (i.original_title && cjkRegex.test(i.original_title)) i.original_title = i.title || '';
        // sometimes name itself might be Japanese if Georgian is missing
        if (i.name && cjkRegex.test(i.name)) i.name = i.original_name || '';
      };
      if (data.results && Array.isArray(data.results)) {
        // Filter out Indian content (Hindi, Tamil, Telugu, Malayalam, Kannada)
        const indianLangs = ['hi', 'ta', 'te', 'ml', 'kn'];
        data.results = data.results.filter(i => !indianLangs.includes(i.original_language));
        data.results.forEach(cleanItem);
      } else {
        cleanItem(data);
      }
      return data;
    }

    try {
      let r = await fetch(url);
      let d = await r.json();

      const cjkRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\uFAFF\uFF66-\uFF9F]/;
      const hasCJK = (str) => str && cjkRegex.test(str);
      const isJapaneseData = (data) => {
        if (data.results && data.results.length > 0) {
          return hasCJK(data.results[0].title) || hasCJK(data.results[0].name);
        }
        return hasCJK(data.title) || hasCJK(data.name);
      };

      // Fallback to English if no results, OR if the returned main title is Japanese/Chinese
      if ((!d.results?.length && !d.title && !d.name) || d.success === false || isJapaneseData(d)) {
        url.searchParams.set('language', CONFIG.TMDB_LANGUAGE_FALLBACK);
        r = await fetch(url);
        d = await r.json();
      }
      d = cleanData(d);
      _cache.set(key, d);
      return d;
    } catch {
      url.searchParams.set('language', CONFIG.TMDB_LANGUAGE_FALLBACK);
      try {
        const r = await fetch(url);
        let d = await r.json();
        d = cleanData(d);
        _cache.set(key, d);
        return d;
      } catch { return null; }
    }
  }

  // Section endpoint with optional query params already in string
  async function section(endpoint, page = 1) {
    const [path, qs] = endpoint.split('?');
    const extra = { page };
    if (qs) qs.split('&').forEach(p => { const [k,v] = p.split('='); if(k) extra[k] = v; });
    
    let isAnimeDiscover = endpoint.includes('with_genres=16') && endpoint.includes('with_original_language=ja');
    
    try {
      const data = await req(path, extra);
      if (isAnimeDiscover && page === 1 && typeof CUSTOM_ANIMES !== 'undefined') {
        // Prepend custom animes that are not already in the results
        const existingTmdbIds = new Set(data.results.map(i => String(i.id)));
        const toAdd = CUSTOM_ANIMES.filter(c => !c.tmdb_id || !existingTmdbIds.has(String(c.tmdb_id)));
        data.results = [...toAdd, ...data.results];
      }
      return data;
    } catch (e) {
      if (isAnimeDiscover && page === 1 && typeof CUSTOM_ANIMES !== 'undefined') {
        return { page: 1, results: CUSTOM_ANIMES, total_pages: 1, total_results: CUSTOM_ANIMES.length };
      }
      return null;
    }
  }

  async function trending()      { return req('/trending/all/day'); }
  async function genres()        {
    const [m, t] = await Promise.all([req('/genre/movie/list'), req('/genre/tv/list')]);
    const map = {};
    [...(m?.genres||[]), ...(t?.genres||[])].forEach(g => map[g.id] = g.name);
    return map;
  }
  async function detail(id, type) {
    return req(`/${type}/${id}`, { append_to_response: 'similar,external_ids,videos' });
  }
  async function season(tvId, num) {
    return req(`/tv/${tvId}/season/${num}`);
  }
  async function search(query, page = 1) {
    if (!query) return { results: [] };
    return req('/search/multi', { query, page });
  }
  async function discover(type, params = {}) {
    if (type === 'tv' && params.with_genres === '16' && params.with_original_language === 'ja') {
      if (typeof CUSTOM_ANIMES !== 'undefined') {
        return { page: 1, results: CUSTOM_ANIMES, total_pages: 1, total_results: CUSTOM_ANIMES.length };
      }
    }
    return req(`/discover/${type}`, params);
  }

  return { req, section, trending, genres, detail, season, search, discover };

})();
