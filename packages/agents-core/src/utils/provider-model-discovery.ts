import { createHash } from 'node:crypto';
import { ANTHROPIC_MODELS, GOOGLE_MODELS, OPENAI_MODELS } from '../constants/models';
import type { ProviderCredentialProvider } from '../validation/schemas';
import { getLogger } from './logger';

const logger = getLogger('ProviderModelDiscovery');

export type AvailableModel = { id: string; label?: string };

const PROBE_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { models: AvailableModel[]; expiresAt: number };
const probeCache = new Map<string, CacheEntry>();

function cacheKey(provider: string, baseUrl: string | null, apiKey: string): string {
  const keyHash = createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  return `${provider}|${baseUrl ?? ''}|${keyHash}`;
}

function getCached(key: string): AvailableModel[] | null {
  const entry = probeCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    probeCache.delete(key);
    return null;
  }
  return entry.models;
}

function setCached(key: string, models: AvailableModel[]): void {
  probeCache.set(key, { models, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function _clearProviderModelCacheForTests(): void {
  probeCache.clear();
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function toCuratedList(
  values: Record<string, string>,
  formatLabel: (id: string) => string
): AvailableModel[] {
  return Object.values(values).map((id) => ({ id, label: formatLabel(id) }));
}

const ANTHROPIC_CURATED = toCuratedList(ANTHROPIC_MODELS, (id) =>
  id.replace('anthropic/', '').replace(/-/g, ' ')
);
const OPENAI_CURATED = toCuratedList(OPENAI_MODELS, (id) => id.replace('openai/', ''));
const GOOGLE_CURATED = toCuratedList(GOOGLE_MODELS, (id) => id.replace('google/', ''));

async function probeOpenAICompatible(params: {
  baseUrl: string;
  apiKey: string;
  idPrefix: string;
}): Promise<AvailableModel[]> {
  const base = params.baseUrl.replace(/\/+$/, '');
  const url = `${base}/models`;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
  const raw = Array.isArray(json?.data) ? json.data : [];
  const ids = raw
    .map((m) => (typeof m?.id === 'string' ? m.id : null))
    .filter((id): id is string => !!id);
  return ids.map((id) => ({ id: `${params.idPrefix}${id}`, label: id }));
}

/**
 * Discover the set of models a project can call for a single provider.
 *
 * - Built-in providers (anthropic, google) return a curated, hard-coded list
 *   because their REST `/models` endpoint is noisy or restricted.
 * - openai and openrouter combine the curated list with whatever `/models`
 *   reports, so users see both familiar names and anything new the account
 *   has access to.
 * - `custom` MUST probe `<baseUrl>/models`. There is no curated fallback —
 *   the whole point of `custom` is that we don't know the catalog upfront.
 *
 * Results are cached in-process for 5 minutes per
 * (provider, baseUrl, apiKey-fingerprint) so opening the model picker
 * doesn't fan out to upstream every time.
 */
export async function discoverModelsForProvider(params: {
  provider: ProviderCredentialProvider;
  apiKey: string;
  baseUrl: string | null;
}): Promise<AvailableModel[]> {
  const { provider, apiKey, baseUrl } = params;
  const key = cacheKey(provider, baseUrl, apiKey);
  const cached = getCached(key);
  if (cached) return cached;

  let models: AvailableModel[] = [];

  switch (provider) {
    case 'anthropic':
      models = ANTHROPIC_CURATED;
      break;
    case 'google':
      models = GOOGLE_CURATED;
      break;
    case 'openai': {
      models = OPENAI_CURATED;
      try {
        const probed = await probeOpenAICompatible({
          baseUrl: baseUrl ?? 'https://api.openai.com/v1',
          apiKey,
          idPrefix: 'openai/',
        });
        models = mergeUnique(models, probed);
      } catch (err) {
        logger.debug(
          { err: (err as Error).message },
          'OpenAI /models probe failed, using curated list'
        );
      }
      break;
    }
    case 'openrouter': {
      try {
        const probed = await probeOpenAICompatible({
          baseUrl: baseUrl ?? 'https://openrouter.ai/api/v1',
          apiKey,
          idPrefix: 'openrouter/',
        });
        models = probed;
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'OpenRouter /models probe failed');
      }
      break;
    }
    case 'custom': {
      if (!baseUrl) {
        throw new Error('Custom credential is missing baseUrl');
      }
      models = await probeOpenAICompatible({ baseUrl, apiKey, idPrefix: 'custom/' });
      break;
    }
    default:
      models = [];
  }

  setCached(key, models);
  return models;
}

function mergeUnique(a: AvailableModel[], b: AvailableModel[]): AvailableModel[] {
  const seen = new Set<string>();
  const out: AvailableModel[] = [];
  for (const item of [...a, ...b]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
