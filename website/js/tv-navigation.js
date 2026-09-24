const MyFilmTVNavigation = (() => {
  const SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[role="link"],[tabindex]:not([tabindex="-1"])';
  const enabled = /MyFilmTV|Android TV|SmartTV|SMART-TV/i.test(navigator.userAgent) || new URLSearchParams(location.search).get('tv') === '1';

  function visible(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !element.closest('[hidden],.view--hidden');
  }

  function focusables() {
    return [...document.querySelectorAll(SELECTOR)].filter(visible);
  }

  function isValidFocusTarget(element) {
    return Boolean(element?.matches?.(SELECTOR) && visible(element));
  }

  function preparePlayerFocusTargets(root = document) {
    root.querySelectorAll?.('.view--active iframe, .view--active video[controls], .view--active [data-player-fullscreen-hit]')
      .forEach(element => {
        if (element.tabIndex < 0 || !element.hasAttribute('tabindex')) element.tabIndex = 0;
      });
  }

  function center(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function nextInDirection(current, direction) {
    if (!isValidFocusTarget(current)) return focusables()[0] || null;
    const origin = center(current);
    const vertical = direction === 'up' || direction === 'down';
    const sign = direction === 'up' || direction === 'left' ? -1 : 1;
    let candidates = focusables().filter(candidate => candidate !== current);
    if (!vertical && current.classList.contains('movie-card')) {
      const cards = candidates.filter(candidate => candidate.classList.contains('movie-card'));
      if (cards.length) candidates = cards;
    }
    return candidates.map(candidate => {
      const point = center(candidate);
      const primary = vertical ? (point.y - origin.y) * sign : (point.x - origin.x) * sign;
      if (primary <= 4) return null;
      const cross = vertical ? Math.abs(point.x - origin.x) : Math.abs(point.y - origin.y);
      return { candidate, score: primary + cross * 2.4 };
    }).filter(Boolean).sort((a, b) => a.score - b.score)[0]?.candidate || null;
  }

  function focusInitial() {
    preparePlayerFocusTargets();
    if (isValidFocusTarget(document.activeElement)) return;
    const target = document.querySelector('.view--active .movie-card,[data-route].active,.nav-brand') || focusables()[0];
    target?.focus({ preventScroll: true });
  }

  function onKeyDown(event) {
    if (!enabled) return;
    const keyMap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const direction = keyMap[event.key];
    const active = document.activeElement;
    if (direction) {
      if (active?.matches('input,textarea') || (active?.matches('select') && (direction === 'up' || direction === 'down'))) return;
      const next = nextInDirection(active, direction);
      if (next) {
        event.preventDefault();
        next.focus({ preventScroll: true });
        next.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && active?.matches('[role="link"]')) {
      event.preventDefault();
      active.click();
      return;
    }
    if (event.key === 'Escape' || event.key === 'BrowserBack' || event.key === 'GoBack') {
      event.preventDefault();
      MyFilmPlatform.handleBack();
    }
  }

  if (enabled) {
    document.documentElement.classList.add('myfilm-tv');
    preparePlayerFocusTargets();
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('myfilm:navigation', () => requestAnimationFrame(focusInitial));
    new MutationObserver(() => {
      preparePlayerFocusTargets();
      if (!isValidFocusTarget(document.activeElement)) requestAnimationFrame(focusInitial);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    requestAnimationFrame(focusInitial);
  }

  return { enabled, focusInitial, nextInDirection, preparePlayerFocusTargets };
})();

window.MyFilmTVNavigation = MyFilmTVNavigation;
