import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  commonGetErrorResponses,
  createApiError,
  createProviderCredential,
  deleteProviderCredential,
  discoverModelsForProvider,
  ErrorResponseSchema,
  getProviderCredential,
  getProviderCredentialDecrypted,
  listProviderCredentials,
  type OrgRole,
  OrgRoles,
  ProviderCredentialApiInsertSchema,
  ProviderCredentialApiSelectSchema,
  ProviderCredentialApiUpdateSchema,
  ProviderCredentialListResponseSchema,
  ProviderCredentialResponseSchema,
  ProviderCredentialTestRequestSchema,
  ProviderCredentialTestResponseSchema,
  recordProviderCredentialTest,
  TenantIdParamsSchema,
  TenantParamsSchema,
  testProviderConnection,
  updateProviderCredential,
} from '@inkeep/agents-core';
import { createProtectedRoute, inheritedManageTenantAuth } from '@inkeep/agents-core/middleware';
import type { Context } from 'hono';
import runDbClient from '../../../data/db/runDbClient';
import type { ManageAppVariables } from '../../../types/app';

const app = new OpenAPIHono<{ Variables: ManageAppVariables }>();

// Provider credentials are tenant/org-wide: any org member can read them, but only
// org admins/owners may mutate (create/update/delete/test). Tenant membership and
// `tenantRole` are enforced upstream by requireTenantAccess() in createApp.ts.
function assertOrgAdmin(c: Context<{ Variables: ManageAppVariables }>): void {
  const tenantRole = c.get('tenantRole') as OrgRole | undefined;
  if (!tenantRole || (tenantRole !== OrgRoles.ADMIN && tenantRole !== OrgRoles.OWNER)) {
    throw createApiError({ code: 'forbidden', message: 'Admin access required' });
  }
}

app.openapi(
  createProtectedRoute({
    method: 'get',
    path: '/',
    summary: 'List Provider Credentials',
    operationId: 'list-provider-credentials',
    tags: ['Provider Credentials'],
    permission: inheritedManageTenantAuth(),
    request: {
      params: TenantParamsSchema,
    },
    responses: {
      200: {
        description: 'List of provider credentials retrieved successfully',
        content: {
          'application/json': { schema: ProviderCredentialListResponseSchema },
        },
      },
      ...commonGetErrorResponses,
    },
  }),
  async (c) => {
    const db = runDbClient;
    const { tenantId } = c.req.valid('param');
    const data = await listProviderCredentials(db)({
      scopes: { tenantId },
    });
    return c.json({ data });
  }
);

app.openapi(
  createProtectedRoute({
    method: 'post',
    path: '/',
    summary: 'Create Provider Credential',
    operationId: 'create-provider-credential',
    tags: ['Provider Credentials'],
    permission: inheritedManageTenantAuth(),
    request: {
      params: TenantParamsSchema,
      body: {
        content: {
          'application/json': { schema: ProviderCredentialApiInsertSchema },
        },
      },
    },
    responses: {
      201: {
        description: 'Provider credential created',
        content: {
          'application/json': { schema: ProviderCredentialResponseSchema },
        },
      },
      ...commonGetErrorResponses,
    },
  }),
  async (c) => {
    assertOrgAdmin(c);
    const db = runDbClient;
    const { tenantId } = c.req.valid('param');
    const body = c.req.valid('json');
    const userId = c.get('userId') as string | undefined;

    const credential = await createProviderCredential(db)({
      scopes: { tenantId },
      id: body.id,
      provider: body.provider,
      label: body.label,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      enabled: body.enabled,
      createdBy: userId,
    });

    return c.json({ data: ProviderCredentialApiSelectSchema.parse(credential) }, 201);
  }
);

app.openapi(
  createProtectedRoute({
    method: 'patch',
    path: '/{id}',
    summary: 'Update Provider Credential',
    operationId: 'update-provider-credential',
    tags: ['Provider Credentials'],
    permission: inheritedManageTenantAuth(),
    request: {
      params: TenantIdParamsSchema,
      body: {
        content: {
          'application/json': { schema: ProviderCredentialApiUpdateSchema },
        },
      },
    },
    responses: {
      200: {
        description: 'Provider credential updated',
        content: {
          'application/json': { schema: ProviderCredentialResponseSchema },
        },
      },
      ...commonGetErrorResponses,
    },
  }),
  async (c) => {
    assertOrgAdmin(c);
    const db = runDbClient;
    const { tenantId, id } = c.req.valid('param');
    const body = c.req.valid('json');

    const credential = await updateProviderCredential(db)({
      scopes: { tenantId },
      id,
      data: body,
    });

    if (!credential) {
      throw createApiError({
        code: 'not_found',
        message: 'Provider credential not found',
      });
    }
    return c.json({ data: ProviderCredentialApiSelectSchema.parse(credential) });
  }
);

app.openapi(
  createProtectedRoute({
    method: 'delete',
    path: '/{id}',
    summary: 'Delete Provider Credential',
    operationId: 'delete-provider-credential',
    tags: ['Provider Credentials'],
    permission: inheritedManageTenantAuth(),
    request: {
      params: TenantIdParamsSchema,
    },
    responses: {
      204: { description: 'Deleted' },
      404: {
        description: 'Provider credential not found',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  }),
  async (c) => {
    assertOrgAdmin(c);
    const db = runDbClient;
    const { tenantId, id } = c.req.valid('param');
    const deleted = await deleteProviderCredential(db)({
      scopes: { tenantId },
      id,
    });
    if (!deleted) {
      throw createApiError({
        code: 'not_found',
        message: 'Provider credential not found',
      });
    }
    return c.body(null, 204);
  }
);

app.openapi(
  createProtectedRoute({
    method: 'post',
    path: '/test',
    summary: 'Test Provider Credentials',
    operationId: 'test-provider-credential',
    tags: ['Provider Credentials'],
    permission: inheritedManageTenantAuth(),
    request: {
      params: TenantParamsSchema,
      body: {
        content: {
          'application/json': { schema: ProviderCredentialTestRequestSchema },
        },
      },
    },
    responses: {
      200: {
        description: 'Test result',
        content: {
          'application/json': { schema: ProviderCredentialTestResponseSchema },
        },
      },
      ...commonGetErrorResponses,
    },
  }),
  async (c) => {
    assertOrgAdmin(c);
    const body = c.req.valid('json');
    const result = await testProviderConnection({
      provider: body.provider,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
    });
    return c.json(result);
  }
);

app.openapi(
  createProtectedRoute({
    method: 'post',
    path: '/{id}/test',
    summary: 'Test Stored Provider Credential',
    operationId: 'test-stored-provider-credential',
    tags: ['Provider Credentials'],
    permission: inheritedManageTenantAuth(),
    request: {
      params: TenantIdParamsSchema,
    },
    responses: {
      200: {
        description: 'Test result',
        content: {
          'application/json': { schema: ProviderCredentialTestResponseSchema },
        },
      },
      ...commonGetErrorResponses,
    },
  }),
  async (c) => {
    assertOrgAdmin(c);
    const db = runDbClient;
    const { tenantId, id } = c.req.valid('param');

    const cred = await getProviderCredential(db)({
      scopes: { tenantId },
      id,
    });
    if (!cred) {
      throw createApiError({
        code: 'not_found',
        message: 'Provider credential not found',
      });
    }
    const decrypted = await getProviderCredentialDecrypted(db)({
      scopes: { tenantId },
      provider: cred.provider,
    });
    if (!decrypted) {
      throw createApiError({
        code: 'bad_request',
        message: 'Could not decrypt stored credential',
      });
    }

    const result = await testProviderConnection({
      provider: cred.provider,
      apiKey: decrypted.apiKey,
      baseUrl: decrypted.baseUrl ?? undefined,
    });

    await recordProviderCredentialTest(db)({
      scopes: { tenantId },
      id,
      status: result.success ? 'success' : 'failure',
      message: result.message,
    });

    return c.json(result);
  }
);

const AvailableModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      provider: z.string(),
      models: z.array(z.object({ id: z.string(), label: z.string().optional() })),
      error: z.string().optional(),
    })
  ),
});

// Returns the set of models the tenant can actually pick, derived from the enabled
// provider_credentials rows for this tenant/org.
//
// - Built-in providers contribute their curated lists.
// - `custom` and `openrouter` are probed live against `<baseUrl>/models`, with a 5-min
//   per-process cache so opening the model picker doesn't fan out every time.
// - Probe failures don't fail the whole response — they come back as `error` per provider
//   so the UI can show a tooltip and degrade gracefully.
app.openapi(
  createProtectedRoute({
    method: 'get',
    path: '/available-models',
    summary: 'List Available Models',
    operationId: 'list-available-models',
    tags: ['Provider Credentials'],
    permission: inheritedManageTenantAuth(),
    request: { params: TenantParamsSchema },
    responses: {
      200: {
        description: 'Per-provider list of models the tenant can call',
        content: {
          'application/json': { schema: AvailableModelsResponseSchema },
        },
      },
      ...commonGetErrorResponses,
    },
  }),
  async (c) => {
    const db = runDbClient;
    const { tenantId } = c.req.valid('param');

    const creds = await listProviderCredentials(db)({ scopes: { tenantId } });
    const enabled = creds.filter((cred) => cred.enabled);
    const seenProviders = new Set<string>();

    const data = await Promise.all(
      enabled
        .filter((cred) => {
          if (seenProviders.has(cred.provider)) return false;
          seenProviders.add(cred.provider);
          return true;
        })
        .map(async (cred) => {
          try {
            const decrypted = await getProviderCredentialDecrypted(db)({
              scopes: { tenantId },
              provider: cred.provider,
            });
            if (!decrypted) {
              return { provider: cred.provider, models: [], error: 'Credential not decryptable' };
            }
            const models = await discoverModelsForProvider({
              provider: cred.provider,
              apiKey: decrypted.apiKey,
              baseUrl: decrypted.baseUrl,
            });
            return { provider: cred.provider, models };
          } catch (err) {
            return {
              provider: cred.provider,
              models: [],
              error: (err as Error).message,
            };
          }
        })
    );

    return c.json({ data });
  }
);

// List which providers are configured (just provider names) — used by UI to filter model lists.
app.openapi(
  createProtectedRoute({
    method: 'get',
    path: '/enabled-providers',
    summary: 'List Enabled Providers',
    operationId: 'list-enabled-providers',
    tags: ['Provider Credentials'],
    permission: inheritedManageTenantAuth(),
    request: { params: TenantParamsSchema },
    responses: {
      200: {
        description: 'List of providers that have a usable credential',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(z.string()),
            }),
          },
        },
      },
      ...commonGetErrorResponses,
    },
  }),
  async (c) => {
    const db = runDbClient;
    const { tenantId } = c.req.valid('param');
    const creds = await listProviderCredentials(db)({
      scopes: { tenantId },
    });
    const providers = Array.from(
      new Set(creds.filter((c) => c.enabled).map((c) => c.provider as string))
    );
    return c.json({ data: providers });
  }
);

// Registered AFTER the static GET routes (/available-models, /enabled-providers) so those
// literal paths win over this `/{id}` parameter match.
app.openapi(
  createProtectedRoute({
    method: 'get',
    path: '/{id}',
    summary: 'Get Provider Credential',
    operationId: 'get-provider-credential',
    tags: ['Provider Credentials'],
    permission: inheritedManageTenantAuth(),
    request: {
      params: TenantIdParamsSchema,
    },
    responses: {
      200: {
        description: 'Provider credential found',
        content: {
          'application/json': { schema: ProviderCredentialResponseSchema },
        },
      },
      ...commonGetErrorResponses,
    },
  }),
  async (c) => {
    const db = runDbClient;
    const { tenantId, id } = c.req.valid('param');
    const credential = await getProviderCredential(db)({
      scopes: { tenantId },
      id,
    });
    if (!credential) {
      throw createApiError({
        code: 'not_found',
        message: 'Provider credential not found',
      });
    }
    return c.json({ data: ProviderCredentialApiSelectSchema.parse(credential) });
  }
);

export default app;
