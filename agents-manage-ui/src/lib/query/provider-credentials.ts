'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  type AvailableProviderModels,
  fetchAvailableModels,
  fetchEnabledProviders,
} from '@/lib/api/provider-credentials';

/**
 * Returns the list of provider IDs (e.g. ['openai', 'anthropic']) that have an
 * enabled credential configured for the current tenant/org.
 *
 * Tenant-scoped on purpose: provider credentials live at the org level, so this
 * works everywhere a `tenantId` is in the route — including project creation,
 * where there is no `projectId` yet.
 */
export function useEnabledProvidersQuery({ enabled = true }: { enabled?: boolean } = {}) {
  const { tenantId } = useParams<{ tenantId?: string }>();

  return useQuery<string[]>({
    queryKey: ['enabled-providers', tenantId],
    queryFn: () => {
      if (!tenantId) return Promise.resolve([]);
      return fetchEnabledProviders(tenantId);
    },
    enabled: enabled && Boolean(tenantId),
    staleTime: 30_000,
    initialData: [],
    initialDataUpdatedAt: 0,
    meta: { defaultError: 'Failed to load enabled providers' },
  });
}

/**
 * Returns the models the current tenant/org can actually call, grouped by provider.
 * Drives the model picker so users can't pick a model they have no credential for —
 * and so `custom` providers show whatever `<baseUrl>/models` reports.
 */
export function useAvailableModelsQuery({ enabled = true }: { enabled?: boolean } = {}) {
  const { tenantId } = useParams<{ tenantId?: string }>();

  return useQuery<AvailableProviderModels[]>({
    queryKey: ['available-models', tenantId],
    queryFn: () => {
      if (!tenantId) return Promise.resolve([]);
      return fetchAvailableModels(tenantId);
    },
    enabled: enabled && Boolean(tenantId),
    staleTime: 5 * 60_000,
    initialData: [],
    initialDataUpdatedAt: 0,
    meta: { defaultError: 'Failed to load available models' },
  });
}
