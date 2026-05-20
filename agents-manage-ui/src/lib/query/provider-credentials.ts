'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { fetchEnabledProviders } from '@/lib/api/provider-credentials';

/**
 * Returns the list of provider IDs (e.g. ['openai', 'anthropic']) that have
 * an enabled credential configured for the current project.
 *
 * Used to filter the model dropdown so users only pick models they can actually call.
 */
export function useEnabledProvidersQuery({ enabled = true }: { enabled?: boolean } = {}) {
  const { tenantId, projectId } = useParams<{ tenantId?: string; projectId?: string }>();

  return useQuery<string[]>({
    queryKey: ['enabled-providers', tenantId, projectId],
    queryFn: () => {
      if (!tenantId || !projectId) return Promise.resolve([]);
      return fetchEnabledProviders(tenantId, projectId);
    },
    enabled: enabled && Boolean(tenantId && projectId),
    staleTime: 30_000,
    initialData: [],
    initialDataUpdatedAt: 0,
    meta: { defaultError: 'Failed to load enabled providers' },
  });
}
