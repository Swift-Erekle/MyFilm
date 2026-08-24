import { fetchHtml, isChallengePage, safeErrorCode } from './common.js';
import { PROVIDERS, providerById, providersForType } from './catalog.js';
import { searchGenericProvider } from './generic.js';
export { extractSearchResultCandidates, searchWebForProvider } from './web-search.js';

export { PROVIDERS, providerById, providersForType };
export * from './common.js';

export async function searchExternalProvider(id, context) {
  const provider = providerById(id);
  if (!provider || provider.mode !== 'generic') return [];
  return searchGenericProvider(provider, context);
}

export async function inspectProviderHealth(type = '') {
  const candidates = providersForType(type).filter(provider => provider.mode !== 'direct');
  const checks = await Promise.all(candidates.map(async provider => {
    const started = Date.now();
    try {
      const { text, response } = await fetchHtml(provider.baseUrl, { referer: provider.baseUrl, timeoutMs: 4_500 });
      const healthy = response.ok && text.length > 500 && !isChallengePage(text, response.status);
      return { id: provider.id, label: provider.label, healthy, latencyMs: Date.now() - started, errorCode: healthy ? null : 'PROVIDER_INVALID_RESPONSE' };
    } catch (error) {
      return { id: provider.id, label: provider.label, healthy: false, latencyMs: Date.now() - started, errorCode: safeErrorCode(error) };
    }
  }));
  return [
    ...providersForType(type).filter(provider => provider.mode === 'direct').map(provider => ({ id: provider.id, label: provider.label, healthy: true, latencyMs: 0, errorCode: null })),
    ...checks,
  ];
}
