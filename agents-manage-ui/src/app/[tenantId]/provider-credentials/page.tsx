'use client';

import { Loader2 } from 'lucide-react';
import { use, useEffect, useState } from 'react';
import { ErrorContent } from '@/components/errors/full-page-error';
import { PageHeader } from '@/components/layout/page-header';
import { ProviderCredentialsManager } from '@/components/provider-credentials/provider-credentials-manager';
import { useIsOrgAdmin } from '@/hooks/use-is-org-admin';
import { fetchProviderCredentials, type ProviderCredential } from '@/lib/api/provider-credentials';
import { getErrorCode } from '@/lib/utils/error-serialization';

const TITLE = 'Model Providers';
const DESCRIPTION =
  'Manage API keys for external LLM providers (Anthropic, OpenAI, Google, OpenRouter, OpenAI-compatible). These are shared across the organization — configure them before creating a project, and only providers configured here can be used by your projects and agents.';

export default function ProviderCredentialsPage({
  params,
}: PageProps<'/[tenantId]/provider-credentials'>) {
  const { tenantId } = use(params);
  const { isAdmin: isOrgAdmin, isLoading: isAdminLoading } = useIsOrgAdmin();

  const [credentials, setCredentials] = useState<ProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    fetchProviderCredentials(tenantId)
      .then((data) => {
        if (!cancelled) setCredentials(data);
      })
      .catch((err) => {
        if (!cancelled) setErrorCode(getErrorCode(err) ?? 'unknown');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      {errorCode ? (
        <ErrorContent errorCode={errorCode} context="provider-credentials" />
      ) : loading || isAdminLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ProviderCredentialsManager
          tenantId={tenantId}
          initial={credentials}
          canEdit={isOrgAdmin}
        />
      )}
    </>
  );
}
