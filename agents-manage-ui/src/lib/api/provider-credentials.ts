'use server';

import { cache } from 'react';
import { makeManagementApiRequest } from './api-config';

export type ProviderCredentialProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'custom';

export type ProviderCredential = {
  id: string;
  tenantId: string;
  provider: ProviderCredentialProvider;
  label: string | null;
  baseUrl: string | null;
  enabled: boolean;
  keyPreview: string;
  lastTestStatus: 'success' | 'failure' | 'pending' | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProviderCredentialInput = {
  provider: ProviderCredentialProvider;
  apiKey: string;
  label?: string;
  baseUrl?: string;
  enabled?: boolean;
};

export type ProviderCredentialUpdateInput = {
  apiKey?: string;
  label?: string;
  baseUrl?: string;
  enabled?: boolean;
};

export type TestConnectionResult = {
  success: boolean;
  message: string;
  latencyMs?: number;
};

// Provider credentials are tenant/org-wide (configured before/independent of any project).
const base = (tenantId: string) => `tenants/${tenantId}/provider-credentials`;

async function $fetchProviderCredentials(tenantId: string): Promise<ProviderCredential[]> {
  const res = await makeManagementApiRequest<{ data: ProviderCredential[] }>(base(tenantId));
  return res.data;
}

export const fetchProviderCredentials = cache($fetchProviderCredentials);

async function $fetchEnabledProviders(tenantId: string): Promise<string[]> {
  const res = await makeManagementApiRequest<{ data: string[] }>(
    `${base(tenantId)}/enabled-providers`
  );
  return res.data;
}

export const fetchEnabledProviders = cache($fetchEnabledProviders);

export type AvailableProviderModels = {
  provider: string;
  models: { id: string; label?: string }[];
  error?: string;
};

async function $fetchAvailableModels(tenantId: string): Promise<AvailableProviderModels[]> {
  const res = await makeManagementApiRequest<{ data: AvailableProviderModels[] }>(
    `${base(tenantId)}/available-models`
  );
  return res.data;
}

export const fetchAvailableModels = cache($fetchAvailableModels);

export async function createProviderCredential(
  tenantId: string,
  body: ProviderCredentialInput
): Promise<ProviderCredential> {
  const res = await makeManagementApiRequest<{ data: ProviderCredential }>(base(tenantId), {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function updateProviderCredential(
  tenantId: string,
  id: string,
  body: ProviderCredentialUpdateInput
): Promise<ProviderCredential> {
  const res = await makeManagementApiRequest<{ data: ProviderCredential }>(
    `${base(tenantId)}/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    }
  );
  return res.data;
}

export async function deleteProviderCredential(tenantId: string, id: string): Promise<void> {
  await makeManagementApiRequest<void>(`${base(tenantId)}/${id}`, {
    method: 'DELETE',
  });
}

export async function testProviderCredential(
  tenantId: string,
  body: { provider: ProviderCredentialProvider; apiKey: string; baseUrl?: string }
): Promise<TestConnectionResult> {
  return makeManagementApiRequest<TestConnectionResult>(`${base(tenantId)}/test`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function testStoredProviderCredential(
  tenantId: string,
  id: string
): Promise<TestConnectionResult> {
  return makeManagementApiRequest<TestConnectionResult>(`${base(tenantId)}/${id}/test`, {
    method: 'POST',
  });
}
