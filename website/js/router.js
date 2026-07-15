// ============================================
//  MyFilm - Hash Router
//  Navigate: Router.go('/movie/123/movie')
// ============================================

const Router = (() => {

  const routes = {};
  let currentPath = null;

  function go(path) {
    window.location.hash = '#' + path;
  }

  function register(path, handler) {
    routes[path] = handler;
  }

  function parse(hash) {
    const path = hash.replace(/^#\/?/, '') || '';
    const parts = path.split('/');
    return parts;
  }

  function handle() {
    const parts = parse(window.location.hash);
    const view  = parts[0] || 'home';

    // Hide all views
    document.querySelectorAll('.view').forEach(v => {
      v.classList.add('view--hidden');
      v.classList.remove('view--active');
    });

    // Destroy player if leaving detail page
    if (typeof Player !== 'undefined' && typeof Player.destroy === 'function') {
      Player.destroy();
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'instant' });

    if (routes[view]) {
      const el = document.getElementById('view-' + view);
      if (el) {
        el.classList.remove('view--hidden');
        el.classList.add('view--active');
      }
      routes[view](parts.slice(1));
    } else {
      // Fallback: home
      const el = document.getElementById('view-home');
      if (el) {
        el.classList.remove('view--hidden');
        el.classList.add('view--active');
      }
      if (routes['home']) routes['home']([]);
    }
  }

  window.addEventListener('hashchange', handle);

  // Run on load
  function init() {
    handle();
  }

  return { go, register, parse, init };

})();
