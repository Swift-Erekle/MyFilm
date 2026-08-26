// ============================================
//  MyFilm - TMDB API
// ============================================

const API = (() => {

  const _cache = new Map();
  const CJK_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\uFAFF\uFF66-\uFF9F\uAC00-\uD7AF]/u;
  const hasCJK = value => typeof value === 'string' && CJK_REGEX.test(value);

  function needsEnglishTitles(data) {
    if (!data) return false;
    const itemNeedsEnglish = item => item && [
      item.title, item.name, item.original_title, item.original_name,
    ].some(hasCJK);
    if (Array.isArray(data.results) && data.results.some(itemNeedsEnglish)) return true;
    if (Array.isArray(data.similar?.results) && data.similar.results.some(itemNeedsEnglish)) return true;
    return itemNeedsEnglish(data);
  }

  function mergeEnglishItem(localItem, englishItem) {
    if (!localItem || !englishItem) return localItem;
    for (const key of ['title', 'name']) {
      if (hasCJK(localItem[key]) && englishItem[key] && !hasCJK(englishItem[key])) {
        localItem[key] = englishItem[key];
      }
    }
    if (hasCJK(localItem.original_title) && englishItem.title && !hasCJK(englishItem.title)) {
      localItem.original_title = englishItem.title;
    }
    if (hasCJK(localItem.original_name) && englishItem.name && !hasCJK(englishItem.name)) {
      localItem.original_name = englishItem.name;
    }
    return localItem;
  }

  function mergeEnglishCollection(localItems, englishItems) {
    if (!Array.isArray(localItems) || !Array.isArray(englishItems)) return;
    const englishById = new Map(englishItems.map(item => [String(item.id), item]));
    localItems.forEach(item => mergeEnglishItem(item, englishById.get(String(item.id))));
  }

  function mergeEnglishTitles(localData, englishData) {
    if (!localData || !englishData) return localData;
    if (Array.isArray(localData.results)) {
      mergeEnglishCollection(localData.results, englishData.results);
    } else {
      mergeEnglishItem(localData, englishData);
    }
    mergeEnglishCollection(localData.similar?.results, englishData.similar?.results);
    return localData;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`TMDB_${response.status}`);
    return response.json();
  }

  async function req(endpoint, extra = {}) {
    const url = new URL(CONFIG.TMDB_BASE_URL + endpoint);
    url.searchParams.set('language', CONFIG.TMDB_LANGUAGE);
    Object.entries(extra).forEach(([k,v]) => url.searchParams.set(k, v));

    const key = url.toString();
    if (_cache.has(key)) return _cache.get(key);

    function cleanData(data) {
      if (!data) return data;
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

        if (hasCJK(i.title) && i.original_title && !hasCJK(i.original_title)) i.title = i.original_title;
        if (hasCJK(i.name) && i.original_name && !hasCJK(i.original_name)) i.name = i.original_name;
      };
      if (data.results && Array.isArray(data.results)) {
        // Filter out Indian content (Hindi, Tamil, Telugu, Malayalam, Kannada)
        const indianLangs = ['hi', 'ta', 'te', 'ml', 'kn'];
        data.results = data.results.filter(i => !indianLangs.includes(i.original_language));
        data.results.forEach(cleanItem);
      } else {
        cleanItem(data);
      }
      if (Array.isArray(data.similar?.results)) data.similar.results.forEach(cleanItem);
      return data;
    }

    try {
      let d = await fetchJson(url);
      const englishUrl = new URL(url);
      englishUrl.searchParams.set('language', CONFIG.TMDB_LANGUAGE_FALLBACK);

      if ((Array.isArray(d.results) && !d.results.length) || d.success === false) {
        d = await fetchJson(englishUrl);
      } else if (needsEnglishTitles(d)) {
        const englishData = await fetchJson(englishUrl);
        d = mergeEnglishTitles(d, englishData);
      }
      d = cleanData(d);
      _cache.set(key, d);
      return d;
    } catch {
      const englishUrl = new URL(url);
      englishUrl.searchParams.set('language', CONFIG.TMDB_LANGUAGE_FALLBACK);
      try {
        let d = await fetchJson(englishUrl);
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
