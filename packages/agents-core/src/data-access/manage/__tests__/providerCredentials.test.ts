import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testManageDbClient } from '../../../__tests__/setup';
import { createTestProject } from '../../../db/manage/test-manage-client';
import {
  createProviderCredential,
  deleteProviderCredential,
  getProviderCredential,
  getProviderCredentialDecrypted,
  listEnabledProvidersForProject,
  listProviderCredentials,
  recordProviderCredentialTest,
  updateProviderCredential,
} from '../providerCredentials';

const tenantId = 'tenant-provider-cred';
const projectId = 'project-provider-cred';
const scopes = { tenantId, projectId };
const VALID_HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const originalKey = process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY;

beforeEach(async () => {
  process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY = VALID_HEX_KEY;
  await createTestProject(testManageDbClient, tenantId, projectId);
});

afterEach(async () => {
  const all = await listProviderCredentials(testManageDbClient)({ scopes });
  for (const c of all) {
    await deleteProviderCredential(testManageDbClient)({ scopes, id: c.id });
  }
  if (originalKey === undefined) delete process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY;
  else process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY = originalKey;
});

describe('providerCredentials data-access', () => {
  it('creates, lists, and masks the API key', async () => {
    const created = await createProviderCredential(testManageDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'sk-abcdef1234567890',
      label: 'team',
    });
    expect(created.provider).toBe('openai');
    expect(created.keyPreview).toMatch(/sk-a/);
    expect(created.keyPreview).not.toContain('1234567890');

    const list = await listProviderCredentials(testManageDbClient)({ scopes });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });

  it('decrypts the stored key for runtime use', async () => {
    await createProviderCredential(testManageDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'sk-decrypt-me',
    });
    const decrypted = await getProviderCredentialDecrypted(testManageDbClient)({
      scopes,
      provider: 'openai',
    });
    expect(decrypted?.apiKey).toBe('sk-decrypt-me');
  });

  it('returns null for decryption when no enabled credential exists', async () => {
    await createProviderCredential(testManageDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'sk-disabled',
      enabled: false,
    });
    const decrypted = await getProviderCredentialDecrypted(testManageDbClient)({
      scopes,
      provider: 'openai',
    });
    expect(decrypted).toBeNull();
  });

  it('updates the key and invalidates test status', async () => {
    const created = await createProviderCredential(testManageDbClient)({
      scopes,
      provider: 'google',
      apiKey: 'g-old',
    });
    await recordProviderCredentialTest(testManageDbClient)({
      scopes,
      id: created.id,
      status: 'success',
      message: 'ok',
    });
    const updated = await updateProviderCredential(testManageDbClient)({
      scopes,
      id: created.id,
      data: { apiKey: 'g-new' },
    });
    expect(updated?.lastTestStatus).toBeNull();
    const decrypted = await getProviderCredentialDecrypted(testManageDbClient)({
      scopes,
      provider: 'google',
    });
    expect(decrypted?.apiKey).toBe('g-new');
  });

  it('lists enabled providers (unique)', async () => {
    await createProviderCredential(testManageDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'k1',
    });
    await createProviderCredential(testManageDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'k2',
      label: 'second',
    });
    await createProviderCredential(testManageDbClient)({
      scopes,
      provider: 'anthropic',
      apiKey: 'k3',
      enabled: false,
    });
    const providers = await listEnabledProvidersForProject(testManageDbClient)({ scopes });
    expect(providers.sort()).toEqual(['openai']);
  });

  it('records test result on stored credential', async () => {
    const created = await createProviderCredential(testManageDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'k',
    });
    await recordProviderCredentialTest(testManageDbClient)({
      scopes,
      id: created.id,
      status: 'failure',
      message: 'bad key',
    });
    const fetched = await getProviderCredential(testManageDbClient)({
      scopes,
      id: created.id,
    });
    expect(fetched?.lastTestStatus).toBe('failure');
    expect(fetched?.lastTestMessage).toBe('bad key');
  });

  it('deletes a credential', async () => {
    const created = await createProviderCredential(testManageDbClient)({
      scopes,
      provider: 'openai',
      apiKey: 'sk-x',
    });
    const deleted = await deleteProviderCredential(testManageDbClient)({
      scopes,
      id: created.id,
    });
    expect(deleted).toBe(true);
    const fetched = await getProviderCredential(testManageDbClient)({
      scopes,
      id: created.id,
    });
    expect(fetched).toBeNull();
  });
});
