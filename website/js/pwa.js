const MyFilmPWA = (() => {
  const TV_APK_URL = 'https://github.com/Swift-Erekle/MyFilm/releases/download/v1.1.0/MyFilm-TV.apk';
  let reloadRequested = false;
  let reloadPending = false;

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isTV = () => /MyFilmTV|Android TV|SmartTV|SMART-TV/i.test(navigator.userAgent);
  const isPlayerActive = () => Boolean(
    document.fullscreenElement ||
    document.querySelector('.view--active .iframe-player-wrap iframe, .view--active video')
  );

  function reloadWhenSafe() {
    if (!reloadRequested) return;
    if (isPlayerActive()) {
      reloadPending = true;
      return;
    }
    location.reload();
  }

  function showDialog(mode) {
    const dialog = document.getElementById('app-download-dialog');
    if (!dialog) return;
    dialog.dataset.mode = mode;
    dialog.querySelectorAll('[data-install-panel]').forEach(panel => {
      panel.hidden = panel.dataset.installPanel !== mode;
    });
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  function handleInstallButton() {
    if (isStandalone() || isTV()) return;
    showDialog('tv');
  }

  function showUpdate(registration) {
    if (document.getElementById('pwa-update-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.className = 'pwa-update-banner';
    banner.innerHTML = '<span>MyFilm-ის ახალი ვერსია მზადაა.</span><button type="button">განახლება</button>';
    banner.querySelector('button').addEventListener('click', () => {
      reloadRequested = true;
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
    document.body.appendChild(banner);
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    if (registration.waiting) showUpdate(registration);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(registration);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      reloadWhenSafe();
    });
    window.addEventListener('myfilm:navigation', () => {
      if (reloadPending && !isPlayerActive()) reloadWhenSafe();
    });
  }

  function init() {
    const open = document.getElementById('app-download-open');
    const close = document.getElementById('app-download-close');
    const tvDownload = document.getElementById('tv-download-action');
    if (tvDownload) tvDownload.href = TV_APK_URL;
    open?.addEventListener('click', event => { event.preventDefault(); handleInstallButton(); });
    close?.addEventListener('click', () => document.getElementById('app-download-dialog')?.close());
    document.getElementById('app-download-dialog')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) event.currentTarget.close();
    });
    if (isStandalone() || isTV()) open?.setAttribute('hidden', '');
    registerServiceWorker().catch(error => console.warn('PWA registration failed', error));
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  return { showDialog, tvApkUrl: TV_APK_URL };
})();
