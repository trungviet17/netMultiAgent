import type { Metadata } from 'next';
import FullPageError from '@/components/errors/full-page-error';
import { PageHeader } from '@/components/layout/page-header';
import { ProviderCredentialsManager } from '@/components/provider-credentials/provider-credentials-manager';
import { fetchProjectPermissions } from '@/lib/api/projects';
import { fetchProviderCredentials } from '@/lib/api/provider-credentials';
import { getErrorCode } from '@/lib/utils/error-serialization';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Provider Credentials',
  description:
    'Manage API keys for external LLM providers (Anthropic, OpenAI, Google, OpenRouter, custom). Only providers configured here can be used by models in this project.',
} satisfies Metadata;

export default async function ProviderCredentialsPage({
  params,
}: PageProps<'/[tenantId]/projects/[projectId]/provider-credentials'>) {
  const { tenantId, projectId } = await params;

  try {
    const [credentials, { canEdit }] = await Promise.all([
      fetchProviderCredentials(tenantId, projectId),
      fetchProjectPermissions(tenantId, projectId),
    ]);
    return (
      <>
        <PageHeader title={metadata.title} description={metadata.description} />
        <ProviderCredentialsManager
          tenantId={tenantId}
          projectId={projectId}
          initial={credentials}
          canEdit={canEdit}
        />
      </>
    );
  } catch (error) {
    return <FullPageError errorCode={getErrorCode(error)} context="provider-credentials" />;
  }
}
