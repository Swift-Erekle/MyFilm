export const PROVIDERS = Object.freeze([
  { id: 'ge.movie', label: 'ge.movie', baseUrl: 'https://ge.movie/', types: ['movie', 'tv'], mode: 'direct' },
  { id: 'adjaranetto.com', label: 'adjaranetto.com', baseUrl: 'https://adjaranetto.com/', types: ['movie', 'tv'], mode: 'specialized' },
  { id: 'Croconet.cam', label: 'Croconet.cam', baseUrl: 'https://croconet.cam/', types: ['movie', 'tv'], mode: 'specialized' },
  { id: 'ufasofilmebi.ge', label: 'ufasofilmebi.ge', baseUrl: 'https://ufasofilmebi.ge/', types: ['movie', 'tv'], mode: 'specialized' },
  { id: 'chemikino.com', label: 'chemikino.com', baseUrl: 'https://chemikino.com/', types: ['movie'], mode: 'specialized' },
  { id: 'imovs.ge', label: 'imovs.ge', baseUrl: 'https://www.imovs.ge/', types: ['movie', 'tv'], mode: 'specialized' },
  { id: 'asia.com.ge', label: 'asia.com.ge', baseUrl: 'https://asia.com.ge/', searchUrl: 'https://asia.com.ge/index.php?do=search', searchMethod: 'POST', types: ['movie'], mode: 'generic' },
  { id: 'geofilms.net', label: 'geofilms.net', baseUrl: 'https://geofilms.net/', searchUrl: 'https://geofilms.net/index.php?do=search', searchMethod: 'POST', types: ['movie'], mode: 'generic' },
  { id: 'kinolab.cc', label: 'kinolab.cc', baseUrl: 'https://kinolab.cc/', searchUrl: 'https://kinolab.cc/', searchMethod: 'POST', types: ['movie'], mode: 'generic' },
  { id: 'geosaitebi.tv', label: 'geosaitebi.tv', baseUrl: 'https://geosaitebi.tv/', searchUrl: 'https://geosaitebi.tv/', searchMethod: 'POST', types: ['movie'], mode: 'generic' },
  { id: 'animeb.ge', label: 'animeb.ge', baseUrl: 'https://animeb.ge/', types: ['anime'], mode: 'anime' },
  { id: 'animetv.ge', label: 'animetv.ge', baseUrl: 'https://animetv.ge/', types: ['anime'], mode: 'anime' },
]);

export function providerById(id) {
  return PROVIDERS.find(provider => provider.id.toLowerCase() === String(id || '').toLowerCase()) || null;
}

export function providersForType(type) {
  return PROVIDERS.filter(provider => !type || provider.types.includes(type));
}
