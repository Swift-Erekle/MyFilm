import worker from '../cloudflare.js';

const args = process.argv.slice(2);
const providerArg = args.find(value => value.startsWith('--provider='));
const query = args.filter(value => !value.startsWith('--provider=')).join(' ') || 'Inception 2010';
const allProviders = ['adjaranetto.com', 'Croconet.cam', 'ufasofilmebi.ge', 'chemikino.com', 'imovs.ge', 'asia.com.ge', 'geofilms.net', 'kinolab.cc', 'geosaitebi.tv'];
const providers = providerArg ? [providerArg.slice('--provider='.length)] : allProviders;
const env = { PUBLIC_ORIGIN: 'https://myfilm.local', ALLOWED_ORIGINS: 'https://myfilm.local' };

for (const provider of providers) {
  const target = new URL('https://myfilm.local/imovs');
  target.searchParams.set('q', query);
  target.searchParams.set('eng', query.replace(/\b(?:19|20)\d{2}\b/g, '').trim());
  target.searchParams.set('source', provider);
  const started = Date.now();
  try {
    const response = await worker.fetch(new Request(target), env);
    const data = await response.json();
    const streams = (data.players || []).flatMap(player => player.streams || []);
    console.log(JSON.stringify({ provider, ok: data.ok, errorCode: data.errorCode, streams: streams.length, latencyMs: Date.now() - started }));
  } catch (error) {
    console.log(JSON.stringify({ provider, ok: false, errorCode: 'DIAGNOSTIC_FAILED', message: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - started }));
  }
}
