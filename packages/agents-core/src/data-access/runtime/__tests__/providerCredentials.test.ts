import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testRunDbClient } from '../../../__tests__/setup';
import {
  createProviderCredential,
  deleteProviderCredential,
  getProviderCredential,
  getProviderCredentialDecrypted,
  listEnabledProvidersForTenant,
  listProviderCredentials,
  recordProviderCredentialTest,
  updateProviderCredential,
} from '../providerCredentials';

const tenantId = 'tenant-provider-cred';
const scopes = { tenantId };
const VALID_HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const originalKey = process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY;

beforeEach(() => {
  process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY = VALID_HEX_KEY;
});

afterEach(async () => {
  const all = await listProviderCredentials(testRunDbClient)({ scopes });
  for (const c of all) {
    await deleteProviderCredential(testRunDbClient)({ scopes, id: c.id });
  }
  if (originalKey === undefined) delete process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY;
  else process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY = originalKey;
});

describe('providerCredentials data-access', () => {
  it('creates, lists, and masks the API key', async () => {
    const created = await createProviderCredential(testRunDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'sk-abcdef1234567890',
      label: 'team',
    });
    expect(created.provider).toBe('openai');
    expect(created.keyPreview).toMatch(/sk-a/);
    expect(created.keyPreview).not.toContain('1234567890');

    const list = await listProviderCredentials(testRunDbClient)({ scopes });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });

  it('decrypts the stored key for runtime use', async () => {
    await createProviderCredential(testRunDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'sk-decrypt-me',
    });
    const decrypted = await getProviderCredentialDecrypted(testRunDbClient)({
      scopes,
      provider: 'openai',
    });
    expect(decrypted?.apiKey).toBe('sk-decrypt-me');
  });

  it('returns null for decryption when no enabled credential exists', async () => {
    await createProviderCredential(testRunDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'sk-disabled',
      enabled: false,
    });
    const decrypted = await getProviderCredentialDecrypted(testRunDbClient)({
      scopes,
      provider: 'openai',
    });
    expect(decrypted).toBeNull();
  });

  it('updates the key and invalidates test status', async () => {
    const created = await createProviderCredential(testRunDbClient)({
      scopes,
      provider: 'google',
      apiKey: 'g-old',
    });
    await recordProviderCredentialTest(testRunDbClient)({
      scopes,
      id: created.id,
      status: 'success',
      message: 'ok',
    });
    const updated = await updateProviderCredential(testRunDbClient)({
      scopes,
      id: created.id,
      data: { apiKey: 'g-new' },
    });
    expect(updated?.lastTestStatus).toBeNull();
    const decrypted = await getProviderCredentialDecrypted(testRunDbClient)({
      scopes,
      provider: 'google',
    });
    expect(decrypted?.apiKey).toBe('g-new');
  });

  it('lists enabled providers (unique)', async () => {
    await createProviderCredential(testRunDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'k1',
    });
    await createProviderCredential(testRunDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'k2',
      label: 'second',
    });
    await createProviderCredential(testRunDbClient)({
      scopes,
      provider: 'anthropic',
      apiKey: 'k3',
      enabled: false,
    });
    const providers = await listEnabledProvidersForTenant(testRunDbClient)({ scopes });
    expect(providers.sort()).toEqual(['openai']);
  });

  it('records test result on stored credential', async () => {
    const created = await createProviderCredential(testRunDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'k',
    });
    await recordProviderCredentialTest(testRunDbClient)({
      scopes,
      id: created.id,
      status: 'failure',
      message: 'bad key',
    });
    const fetched = await getProviderCredential(testRunDbClient)({
      scopes,
      id: created.id,
    });
    expect(fetched?.lastTestStatus).toBe('failure');
    expect(fetched?.lastTestMessage).toBe('bad key');
  });

  it('deletes a credential', async () => {
    const created = await createProviderCredential(testRunDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'sk-x',
    });
    const deleted = await deleteProviderCredential(testRunDbClient)({
      scopes,
      id: created.id,
    });
    expect(deleted).toBe(true);
    const fetched = await getProviderCredential(testRunDbClient)({
      scopes,
      id: created.id,
    });
    expect(fetched).toBeNull();
  });
});
