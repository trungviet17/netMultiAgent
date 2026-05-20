import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testProviderConnection } from '../provider-credential-test';

const originalFetch = global.fetch;

function mockFetchOnce(response: { status?: number; body?: string; ok?: boolean }) {
  const status = response.status ?? 200;
  const ok = response.ok ?? (status >= 200 && status < 300);
  global.fetch = vi.fn(async () => ({
    ok,
    status,
    text: async () => response.body ?? '',
  })) as unknown as typeof fetch;
}

describe('testProviderConnection', () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns success for openai 200', async () => {
    mockFetchOnce({ status: 200, body: '{"data":[]}' });
    const res = await testProviderConnection({ provider: 'openai', apiKey: 'sk-x' });
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/OpenAI/i);
  });

  it('returns failure for 401', async () => {
    mockFetchOnce({ status: 401, body: 'invalid key' });
    const res = await testProviderConnection({ provider: 'openai', apiKey: 'sk-bad' });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/401|Authentication/i);
  });

  it('treats anthropic 400 (model rejected) as auth-success', async () => {
    mockFetchOnce({ status: 400, body: 'model not found' });
    const res = await testProviderConnection({ provider: 'anthropic', apiKey: 'sk-ant' });
    expect(res.success).toBe(true);
  });

  it('treats 429 as auth-valid', async () => {
    mockFetchOnce({ status: 429, body: 'rate limit' });
    const res = await testProviderConnection({ provider: 'anthropic', apiKey: 'sk-ant' });
    expect(res.success).toBe(true);
  });

  it('fails fast when custom is missing baseUrl', async () => {
    const res = await testProviderConnection({ provider: 'custom', apiKey: 'sk-x' });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/baseUrl/);
  });

  it('hits the provided baseUrl for custom provider', async () => {
    let capturedUrl: string | undefined;
    global.fetch = vi.fn(async (url: any) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
    }) as unknown as typeof fetch;
    const res = await testProviderConnection({
      provider: 'custom',
      apiKey: 'sk-x',
      baseUrl: 'https://my-llm.example.com/v1',
    });
    expect(res.success).toBe(true);
    expect(capturedUrl).toBe('https://my-llm.example.com/v1/models');
  });

  it('reports network errors gracefully', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const res = await testProviderConnection({ provider: 'openai', apiKey: 'sk-x' });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/ECONNREFUSED/);
  });
});
