// MyFilm History API router. Legacy #/ links are migrated without a reload.
const Router = (() => {
  const routes = {};
  let currentPath = '';

  function normalize(path) {
    let value = String(path || '/').replace(/^#/, '');
    if (!value.startsWith('/')) value = `/${value}`;
    value = value.replace(/\/{2,}/g, '/');
    if (value === '/home') value = '/';
    return value.length > 1 ? value.replace(/\/$/, '') : value;
  }

  function go(path, { replace = false } = {}) {
    const target = normalize(path);
    if (replace) window.history.replaceState({}, '', target);
    else if (`${window.location.pathname}${window.location.search}` !== target) window.history.pushState({}, '', target);
    handle();
  }

  function register(path, handler) {
    routes[path] = handler;
  }

  function parse(path = window.location.pathname) {
    return normalize(path).replace(/^\//, '').split('/').filter(Boolean);
  }

  function routeState() {
    const parts = parse();
    if (!parts.length) return { view: 'home', params: [] };
    if (['movie', 'tv', 'anime'].includes(parts[0]) && parts[1]) {
      const legacyType = parts[2];
      const type = legacyType || (parts[0] === 'movie' ? 'movie' : 'tv');
      return { view: 'movie', params: [parts[1], type] };
    }
    return { view: parts[0], params: parts.slice(1) };
  }

  function handle() {
    const state = routeState();
    const nextPath = window.location.pathname;
    if (currentPath === nextPath && !routes[state.view]) return;
    currentPath = nextPath;

    document.querySelectorAll('.view').forEach(view => {
      view.classList.add('view--hidden');
      view.classList.remove('view--active');
    });
    if (typeof DetailView !== 'undefined' && typeof DetailView.cleanup === 'function') DetailView.cleanup();
    if (typeof Player !== 'undefined' && typeof Player.destroy === 'function') Player.destroy();
    window.scrollTo({ top: 0, behavior: 'instant' });

    const handler = routes[state.view] || routes.home;
    const targetView = routes[state.view] ? state.view : 'home';
    const element = document.getElementById(`view-${targetView}`);
    element?.classList.remove('view--hidden');
    element?.classList.add('view--active');
    handler?.(routes[state.view] ? state.params : []);
    window.dispatchEvent(new CustomEvent('myfilm:navigation', { detail: state }));
  }

  function init() {
    if (window.location.hash.startsWith('#/')) {
      window.history.replaceState({}, '', normalize(window.location.hash.slice(1)));
    }
    handle();
  }

  window.addEventListener('popstate', handle);
  return { go, register, parse, init, current: routeState };
})();
