const ALLOWED_PROXY_HOSTS = [
  'adjaranetto.com', 'adjaraneti.xyz', 'mykadri.vip', 'croconet.cam', 'croco.cam', 'embed.croconet.cam',
  'ufasofilmebi.ge', 'chemikino.com', 'imovs.ge', 'asia.com.ge', 'geofilms.net', 'kinolab.cc', 'geosaitebi.tv',
  'animeb.ge', 'animetv.ge', 'csst.online', 'ok.ru', 'vkvideo.ru', 'vk.com', 'sibnet.ru', 'video.sibnet.ru',
  'mail.ru', 'my.mail.ru', 'videoapi.my.mail.ru', 'stormo.online', 'secvideo.online', 'drive.google.com',
  'googleusercontent.com', 'googlevideo.com', 'incvideo.com', 'incvideo1.online', 'incvideo.online', 'fmovie-core', 'allarknow.online',
  'vidsrc-embed.ru', 'vsembed.ru', 'vidsrc.me', 'rumble.com',
];

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function isAllowedProxyUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || isPrivateHostname(url.hostname)) return false;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return ALLOWED_PROXY_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export function allowedOrigins(env = {}) {
  return String(env.ALLOWED_ORIGINS || env.PUBLIC_ORIGIN || '')
    .split(',')
    .map(value => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function corsOrigin(request, env = {}) {
  const requestOrigin = request.headers.get('Origin');
  if (!requestOrigin) return new URL(request.url).origin;
  const allowed = allowedOrigins(env);
  return allowed.includes(requestOrigin.replace(/\/$/, '')) ? requestOrigin : '';
}

export function publicOrigin(request, env = {}) {
  const configured = String(env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
  return configured || new URL(request.url).origin;
}
