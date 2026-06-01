import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _clearProviderModelCacheForTests,
  discoverModelsForProvider,
} from '../provider-model-discovery';

const originalFetch = global.fetch;

describe('discoverModelsForProvider', () => {
  beforeEach(() => {
    _clearProviderModelCacheForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns the curated Anthropic list without probing the network', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const models = await discoverModelsForProvider({
      provider: 'anthropic',
      apiKey: 'sk-ant',
      baseUrl: null,
    });

    expect(models.length).toBeGreaterThan(0);
    expect(models[0].id.startsWith('anthropic/')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('probes <baseUrl>/models for custom providers and prefixes ids with custom/', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'openai/gpt-5.1' }, { id: 'anthropic/claude-sonnet-4-5' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    ) as any;

    const models = await discoverModelsForProvider({
      provider: 'custom',
      apiKey: 'sk-key',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer sk-key' },
      })
    );
    expect(models).toEqual([
      { id: 'custom/openai/gpt-5.1', label: 'openai/gpt-5.1' },
      { id: 'custom/anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
    ]);
  });

  it('throws when custom provider has no baseUrl', async () => {
    await expect(
      discoverModelsForProvider({ provider: 'custom', apiKey: 'sk', baseUrl: null })
    ).rejects.toThrow(/baseUrl/);
  });

  it('caches results within the TTL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'm1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    global.fetch = fetchSpy as any;

    await discoverModelsForProvider({
      provider: 'custom',
      apiKey: 'sk',
      baseUrl: 'https://x.test/v1',
    });
    await discoverModelsForProvider({
      provider: 'custom',
      apiKey: 'sk',
      baseUrl: 'https://x.test/v1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('uses separate cache keys per apiKey fingerprint', async () => {
    const fetchSpy = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 'm1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    global.fetch = fetchSpy as any;

    await discoverModelsForProvider({
      provider: 'custom',
      apiKey: 'sk-a',
      baseUrl: 'https://x.test/v1',
    });
    await discoverModelsForProvider({
      provider: 'custom',
      apiKey: 'sk-b',
      baseUrl: 'https://x.test/v1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to curated OpenAI list when /models probe fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 })) as any;

    const models = await discoverModelsForProvider({
      provider: 'openai',
      apiKey: 'sk-bad',
      baseUrl: null,
    });

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.id.startsWith('openai/'))).toBe(true);
  });
});
