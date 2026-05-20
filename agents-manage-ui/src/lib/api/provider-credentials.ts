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
  projectId: string;
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

const base = (tenantId: string, projectId: string) =>
  `tenants/${tenantId}/projects/${projectId}/provider-credentials`;

async function $fetchProviderCredentials(
  tenantId: string,
  projectId: string
): Promise<ProviderCredential[]> {
  const res = await makeManagementApiRequest<{ data: ProviderCredential[] }>(
    base(tenantId, projectId)
  );
  return res.data;
}

export const fetchProviderCredentials = cache($fetchProviderCredentials);

async function $fetchEnabledProviders(tenantId: string, projectId: string): Promise<string[]> {
  const res = await makeManagementApiRequest<{ data: string[] }>(
    `${base(tenantId, projectId)}/enabled-providers`
  );
  return res.data;
}

export const fetchEnabledProviders = cache($fetchEnabledProviders);

export async function createProviderCredential(
  tenantId: string,
  projectId: string,
  body: ProviderCredentialInput
): Promise<ProviderCredential> {
  const res = await makeManagementApiRequest<{ data: ProviderCredential }>(
    base(tenantId, projectId),
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
  return res.data;
}

export async function updateProviderCredential(
  tenantId: string,
  projectId: string,
  id: string,
  body: ProviderCredentialUpdateInput
): Promise<ProviderCredential> {
  const res = await makeManagementApiRequest<{ data: ProviderCredential }>(
    `${base(tenantId, projectId)}/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    }
  );
  return res.data;
}

export async function deleteProviderCredential(
  tenantId: string,
  projectId: string,
  id: string
): Promise<void> {
  await makeManagementApiRequest<void>(`${base(tenantId, projectId)}/${id}`, {
    method: 'DELETE',
  });
}

export async function testProviderCredential(
  tenantId: string,
  projectId: string,
  body: { provider: ProviderCredentialProvider; apiKey: string; baseUrl?: string }
): Promise<TestConnectionResult> {
  return makeManagementApiRequest<TestConnectionResult>(`${base(tenantId, projectId)}/test`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function testStoredProviderCredential(
  tenantId: string,
  projectId: string,
  id: string
): Promise<TestConnectionResult> {
  return makeManagementApiRequest<TestConnectionResult>(`${base(tenantId, projectId)}/${id}/test`, {
    method: 'POST',
  });
}
