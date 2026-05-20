import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUsableProviders,
  resolveModelSettingsWithDbCredentials,
} from '../model-credentials-resolver';

const decryptedMock = vi.fn();
vi.mock('../../data-access/manage/providerCredentials', () => ({
  getProviderCredentialDecrypted: () => async (params: any) => decryptedMock(params),
  // other exports we don't use in this test
  listProviderCredentials: () => async () => [],
  listEnabledProvidersForProject: () => async () => [],
  getProviderCredential: () => async () => null,
  createProviderCredential: () => async () => null,
  updateProviderCredential: () => async () => null,
  deleteProviderCredential: () => async () => false,
  recordProviderCredentialTest: () => async () => undefined,
}));

const db = {} as any;
const scopes = { tenantId: 't', projectId: 'p' };

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

  it('does not override an explicit apiKey already on providerOptions', async () => {
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
