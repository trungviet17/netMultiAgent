import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  commonGetErrorResponses,
  createApiError,
  createProviderCredential,
  deleteProviderCredential,
  ErrorResponseSchema,
  getProviderCredential,
  listProviderCredentials,
  ProviderCredentialApiInsertSchema,
  ProviderCredentialApiSelectSchema,
  ProviderCredentialApiUpdateSchema,
  ProviderCredentialListResponseSchema,
  ProviderCredentialResponseSchema,
  ProviderCredentialTestRequestSchema,
  ProviderCredentialTestResponseSchema,
  recordProviderCredentialTest,
  TenantProjectIdParamsSchema,
  TenantProjectParamsSchema,
  testProviderConnection,
  updateProviderCredential,
} from '@inkeep/agents-core';
import { createProtectedRoute } from '@inkeep/agents-core/middleware';
import { requireProjectPermission } from '../../../middleware/projectAccess';
import type { ManageAppVariables } from '../../../types/app';

const app = new OpenAPIHono<{ Variables: ManageAppVariables }>();

app.openapi(
  createProtectedRoute({
    method: 'get',
    path: '/',
    summary: 'List Provider Credentials',
    operationId: 'list-provider-credentials',
    tags: ['Provider Credentials'],
    permission: requireProjectPermission('view'),
    request: {
      params: TenantProjectParamsSchema,
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
    const db = c.get('db');
    const { tenantId, projectId } = c.req.valid('param');
    const data = await listProviderCredentials(db)({
      scopes: { tenantId, projectId },
    });
    return c.json({ data });
  }
);

app.openapi(
  createProtectedRoute({
    method: 'get',
    path: '/{id}',
    summary: 'Get Provider Credential',
    operationId: 'get-provider-credential',
    tags: ['Provider Credentials'],
    permission: requireProjectPermission('view'),
    request: {
      params: TenantProjectIdParamsSchema,
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
    const db = c.get('db');
    const { tenantId, projectId, id } = c.req.valid('param');
    const credential = await getProviderCredential(db)({
      scopes: { tenantId, projectId },
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

app.openapi(
  createProtectedRoute({
    method: 'post',
    path: '/',
    summary: 'Create Provider Credential',
    operationId: 'create-provider-credential',
    tags: ['Provider Credentials'],
    permission: requireProjectPermission('edit'),
    request: {
      params: TenantProjectParamsSchema,
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
    const db = c.get('db');
    const { tenantId, projectId } = c.req.valid('param');
    const body = c.req.valid('json');
    const userId = c.get('userId') as string | undefined;

    const credential = await createProviderCredential(db)({
      scopes: { tenantId, projectId },
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
    permission: requireProjectPermission('edit'),
    request: {
      params: TenantProjectIdParamsSchema,
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
    const db = c.get('db');
    const { tenantId, projectId, id } = c.req.valid('param');
    const body = c.req.valid('json');

    const credential = await updateProviderCredential(db)({
      scopes: { tenantId, projectId },
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
    permission: requireProjectPermission('edit'),
    request: {
      params: TenantProjectIdParamsSchema,
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
    const db = c.get('db');
    const { tenantId, projectId, id } = c.req.valid('param');
    const deleted = await deleteProviderCredential(db)({
      scopes: { tenantId, projectId },
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
    permission: requireProjectPermission('edit'),
    request: {
      params: TenantProjectParamsSchema,
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
    permission: requireProjectPermission('edit'),
    request: {
      params: TenantProjectIdParamsSchema,
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
    const db = c.get('db');
    const { tenantId, projectId, id } = c.req.valid('param');

    const { getProviderCredentialDecrypted } = await import('@inkeep/agents-core');
    const cred = await getProviderCredential(db)({
      scopes: { tenantId, projectId },
      id,
    });
    if (!cred) {
      throw createApiError({
        code: 'not_found',
        message: 'Provider credential not found',
      });
    }
    const decrypted = await getProviderCredentialDecrypted(db)({
      scopes: { tenantId, projectId },
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
      scopes: { tenantId, projectId },
      id,
      status: result.success ? 'success' : 'failure',
      message: result.message,
    });

    return c.json(result);
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
    permission: requireProjectPermission('view'),
    request: { params: TenantProjectParamsSchema },
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
    const db = c.get('db');
    const { tenantId, projectId } = c.req.valid('param');
    const creds = await listProviderCredentials(db)({
      scopes: { tenantId, projectId },
    });
    const providers = Array.from(
      new Set(creds.filter((c) => c.enabled).map((c) => c.provider as string))
    );
    return c.json({ data: providers });
  }
);

export default app;
