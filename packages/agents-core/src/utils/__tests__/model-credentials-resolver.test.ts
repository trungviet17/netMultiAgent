import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUsableProviders,
  resolveModelSettingsWithDbCredentials,
  resolveModelsWithDbCredentials,
} from '../model-credentials-resolver';

const decryptedMock = vi.fn();
vi.mock('../../data-access/runtime/providerCredentials', () => ({
  getProviderCredentialDecrypted: () => async (params: any) => decryptedMock(params),
  // other exports we don't use in this test
  listProviderCredentials: () => async () => [],
  listEnabledProvidersForTenant: () => async () => [],
  getProviderCredential: () => async () => null,
  createProviderCredential: () => async () => null,
  updateProviderCredential: () => async () => null,
  deleteProviderCredential: () => async () => false,
  recordProviderCredentialTest: () => async () => undefined,
}));

const db = {} as any;
const scopes = { tenantId: 't' };

describe('resolveModelSettingsWithDbCredentials', () => {
  beforeEach(() => {
    decryptedMock.mockReset();
  });

  it('injects DB apiKey into providerOptions', async () => {
    decryptedMock.mockResolvedValueOnce({ apiKey: 'sk-db', baseUrl: null });
    const out = await resolveModelSettingsWithDbCredentials({
      db,
      scopes,
      modelSettings: { model: 'openai/gpt-5' },
    });
    expect(out.providerOptions).toMatchObject({ apiKey: 'sk-db' });
  });

  it('injects baseURL for custom provider', async () => {
    decryptedMock.mockResolvedValueOnce({
      apiKey: 'sk-db',
      baseUrl: 'https://x.example.com/v1',
    });
    const out = await resolveModelSettingsWithDbCredentials({
      db,
      scopes,
      modelSettings: { model: 'custom/my-model' },
    });
    expect(out.providerOptions).toMatchObject({
      apiKey: 'sk-db',
      baseURL: 'https://x.example.com/v1',
    });
  });

  it('returns input unchanged if DB has no credential', async () => {
    decryptedMock.mockResolvedValueOnce(null);
    const input = { model: 'openai/gpt-5' };
    const out = await resolveModelSettingsWithDbCredentials({
      db,
      scopes,
      modelSettings: input,
    });
    expect(out).toEqual(input);
  });

  it('does not override an explicit apiKey for openai (no baseUrl ownership)', async () => {
    decryptedMock.mockResolvedValueOnce({ apiKey: 'sk-db', baseUrl: null });
    const out = await resolveModelSettingsWithDbCredentials({
      db,
      scopes,
      modelSettings: {
        model: 'openai/gpt-5',
        providerOptions: { apiKey: 'sk-explicit' },
      },
    });
    expect(out.providerOptions?.apiKey).toBe('sk-explicit');
    expect(decryptedMock).not.toHaveBeenCalled();
  });

  it('overrides baseURL from credential even when project config has its own baseURL', async () => {
    decryptedMock.mockResolvedValueOnce({
      apiKey: 'sk-db',
      baseUrl: 'https://from-credential.example.com/v1',
    });
    const out = await resolveModelSettingsWithDbCredentials({
      db,
      scopes,
      modelSettings: {
        model: 'custom/openai/gpt-5',
        providerOptions: { baseURL: 'https://stale.example.com/v1' },
      },
    });
    expect(out.providerOptions).toMatchObject({
      apiKey: 'sk-db',
      baseURL: 'https://from-credential.example.com/v1',
    });
  });

  it('keeps explicit apiKey but still overrides baseURL when provider owns baseUrl', async () => {
    decryptedMock.mockResolvedValueOnce({
      apiKey: 'sk-db',
      baseUrl: 'https://from-credential.example.com/v1',
    });
    const out = await resolveModelSettingsWithDbCredentials({
      db,
      scopes,
      modelSettings: {
        model: 'custom/openai/gpt-5',
        providerOptions: { apiKey: 'sk-explicit', baseURL: 'https://stale.example.com/v1' },
      },
    });
    expect(out.providerOptions?.apiKey).toBe('sk-explicit');
    expect(out.providerOptions?.baseURL).toBe('https://from-credential.example.com/v1');
  });

  it('drops legacy baseUrl key in favor of baseURL after override', async () => {
    decryptedMock.mockResolvedValueOnce({
      apiKey: 'sk-db',
      baseUrl: 'https://from-credential.example.com/v1',
    });
    const out = await resolveModelSettingsWithDbCredentials({
      db,
      scopes,
      modelSettings: {
        model: 'custom/openai/gpt-5',
        providerOptions: { baseUrl: 'https://legacy.example.com/v1' },
      },
    });
    expect(out.providerOptions?.baseURL).toBe('https://from-credential.example.com/v1');
    expect(out.providerOptions).not.toHaveProperty('baseUrl');
  });

  it('skips lookup for non-supported providers (e.g. gateway)', async () => {
    const input = { model: 'gateway/anything' };
    const out = await resolveModelSettingsWithDbCredentials({
      db,
      scopes,
      modelSettings: input,
    });
    expect(out).toEqual(input);
    expect(decryptedMock).not.toHaveBeenCalled();
  });

  it('falls back to unchanged settings when the credential lookup throws', async () => {
    decryptedMock.mockRejectedValueOnce(new Error('db.select is not a function'));
    const input = { model: 'custom/openai/gpt-oss-120b' };
    const out = await resolveModelSettingsWithDbCredentials({
      db,
      scopes,
      modelSettings: input,
    });
    expect(out).toEqual(input);
  });

  it('skips lookup when model string is invalid', async () => {
    const input = { model: 'no-slash-model' };
    const out = await resolveModelSettingsWithDbCredentials({
      db,
      scopes,
      modelSettings: input,
    });
    expect(out).toEqual(input);
  });
});

describe('resolveModelsWithDbCredentials', () => {
  beforeEach(() => {
    decryptedMock.mockReset();
  });

  it('returns undefined when models is undefined', async () => {
    const out = await resolveModelsWithDbCredentials({ db, scopes, models: undefined });
    expect(out).toBeUndefined();
    expect(decryptedMock).not.toHaveBeenCalled();
  });

  it('injects credentials into every populated slot (base/structuredOutput/summarizer)', async () => {
    decryptedMock.mockResolvedValue({ apiKey: 'sk-db', baseUrl: 'https://netmind.example/v1' });
    const out = await resolveModelsWithDbCredentials({
      db,
      scopes,
      models: {
        base: { model: 'custom/openai/gpt-oss-120b' },
        structuredOutput: { model: 'custom/openai/gpt-oss-120b' },
        summarizer: { model: 'custom/openai/gpt-4o-mini' },
      },
    });
    expect(out?.base?.providerOptions).toMatchObject({
      apiKey: 'sk-db',
      baseURL: 'https://netmind.example/v1',
    });
    expect(out?.structuredOutput?.providerOptions).toMatchObject({
      apiKey: 'sk-db',
      baseURL: 'https://netmind.example/v1',
    });
    expect(out?.summarizer?.providerOptions).toMatchObject({
      apiKey: 'sk-db',
      baseURL: 'https://netmind.example/v1',
    });
  });

  it('leaves undefined slots undefined', async () => {
    decryptedMock.mockResolvedValue({ apiKey: 'sk-db', baseUrl: null });
    const out = await resolveModelsWithDbCredentials({
      db,
      scopes,
      models: { base: { model: 'openai/gpt-5' } },
    });
    expect(out?.base?.providerOptions).toMatchObject({ apiKey: 'sk-db' });
    expect(out).not.toHaveProperty('structuredOutput');
    expect(out).not.toHaveProperty('summarizer');
  });

  it('passes slots through unchanged when no DB credential exists', async () => {
    decryptedMock.mockResolvedValue(null);
    const out = await resolveModelsWithDbCredentials({
      db,
      scopes,
      models: { base: { model: 'anthropic/claude-sonnet-4-5' } },
    });
    expect(out?.base).toEqual({ model: 'anthropic/claude-sonnet-4-5' });
  });
});

describe('getUsableProviders', () => {
  const original = { ...process.env };
  beforeEach(() => {
    decryptedMock.mockReset();
    for (const k of [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GOOGLE_GENERATIVE_AI_API_KEY',
      'OPENROUTER_API_KEY',
    ]) {
      delete process.env[k];
    }
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('returns union of DB providers and env-backed providers', async () => {
    decryptedMock.mockImplementation(async ({ provider }: any) =>
      provider === 'openai' ? { apiKey: 'k', baseUrl: null } : null
    );
    process.env.ANTHROPIC_API_KEY = 'env-key';

    const providers = await getUsableProviders({ db, scopes });
    expect(providers).toEqual(expect.arrayContaining(['openai', 'anthropic']));
    expect(providers).not.toContain('google');
  });
});
