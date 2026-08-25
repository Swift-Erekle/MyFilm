const MyFilmPlatform = (() => {
  function post(type, payload = {}) {
    try {
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type, ...payload }));
    } catch { /* native bridge is optional in browsers */ }
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement;
  }

  function sync(active = Boolean(fullscreenElement())) {
    post('MYFILM_FULLSCREEN', { active });
    window.dispatchEvent(new CustomEvent('myfilm:fullscreen', { detail: { active } }));
  }

  async function exit() {
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch { /* the provider/WebView may already have closed fullscreen */ }
    sync(false);
    return true;
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
    sync(active);
  });
  document.addEventListener('webkitfullscreenchange', () => sync(Boolean(document.webkitFullscreenElement)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && fullscreenElement()) { event.preventDefault(); exit(); }
  });

  return { exit, handleBack, isFullscreen: () => Boolean(fullscreenElement()), post };
})();

window.MyFilmPlatform = MyFilmPlatform;
