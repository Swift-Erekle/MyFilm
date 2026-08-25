const MyFilmPlatform = (() => {
  let cssFullscreenElement = null;

  function post(type, payload = {}) {
    try {
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type, ...payload }));
    } catch { /* native bridge is optional in browsers */ }
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || cssFullscreenElement;
  }

  async function lockLandscape() {
    try { await screen.orientation?.lock?.('landscape'); } catch { /* browser may not permit orientation lock */ }
  }

  function unlockOrientation() {
    try { screen.orientation?.unlock?.(); } catch { /* optional browser API */ }
  }

  function setCssFullscreen(element, active) {
    if (active) {
      cssFullscreenElement = element;
      element.classList.add('myfilm-css-fullscreen');
      document.documentElement.classList.add('myfilm-fullscreen-active');
      document.body.classList.add('myfilm-fullscreen-active');
    } else {
      cssFullscreenElement?.classList.remove('myfilm-css-fullscreen');
      cssFullscreenElement = null;
      document.documentElement.classList.remove('myfilm-fullscreen-active');
      document.body.classList.remove('myfilm-fullscreen-active');
    }
  }

  function sync(active = Boolean(fullscreenElement())) {
    document.documentElement.classList.toggle('myfilm-fullscreen-active', active);
    document.body.classList.toggle('myfilm-fullscreen-active', active);
    document.querySelectorAll('[data-myfilm-fullscreen]').forEach(button => {
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? 'სრული ეკრანიდან გამოსვლა' : 'სრულ ეკრანზე გადიდება');
      button.textContent = active ? '✕' : '⛶';
    });
    post('MYFILM_FULLSCREEN', { active });
    window.dispatchEvent(new CustomEvent('myfilm:fullscreen', { detail: { active } }));
  }

  async function enter(element) {
    if (!element) return false;
    post('MYFILM_FULLSCREEN', { active: true });
    await lockLandscape();
    try {
      const request = element.requestFullscreen || element.webkitRequestFullscreen;
      if (!request) throw new Error('fullscreen_api_unavailable');
      await request.call(element, { navigationUI: 'hide' });
    } catch {
      setCssFullscreen(element, true);
      sync(true);
    }
    return true;
  }

  async function exit() {
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch { /* CSS cleanup below is still required */ }
    setCssFullscreen(cssFullscreenElement, false);
    unlockOrientation();
    sync(false);
    return true;
  }

  async function toggle(element) {
    return fullscreenElement() ? exit() : enter(element);
  }

  function closeTransientUi() {
    const dialog = document.querySelector('dialog[open]');
    if (dialog) { dialog.close(); return true; }
    const playerPanel = document.getElementById('burger-panel');
    if (playerPanel?.classList.contains('open')) {
      document.getElementById('burger-close')?.click();
      return true;
    }
    const nav = document.querySelector('.nav-links.nav-open');
    if (nav) { document.getElementById('nav-burger')?.click(); return true; }
    return false;
  }

  async function handleBack() {
    if (fullscreenElement()) { await exit(); post('MYFILM_BACK_RESULT', { handled: true }); return true; }
    if (closeTransientUi()) { post('MYFILM_BACK_RESULT', { handled: true }); return true; }
    if (window.location.pathname !== '/') {
      history.back();
      post('MYFILM_BACK_RESULT', { handled: true });
      return true;
    }
    post('MYFILM_BACK_RESULT', { handled: false });
    return false;
  }

  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    if (!active) { unlockOrientation(); setCssFullscreen(cssFullscreenElement, false); }
    sync(active);
  });
  document.addEventListener('webkitfullscreenchange', () => sync(Boolean(document.webkitFullscreenElement)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && fullscreenElement()) { event.preventDefault(); exit(); }
  });

  return { enter, exit, toggle, handleBack, isFullscreen: () => Boolean(fullscreenElement()), post };
})();

window.MyFilmPlatform = MyFilmPlatform;
