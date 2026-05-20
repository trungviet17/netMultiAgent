import { getProviderCredentialDecrypted } from '../data-access/manage/providerCredentials';
import type { AgentsManageDatabaseClient } from '../db/manage/manage-client';
import type { ProjectScopeConfig } from '../types/index';
import type { ModelSettings } from '../validation/schemas';
import { ModelFactory } from './model-factory';

const PROVIDERS_WITH_DB_CREDENTIALS = new Set([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'custom',
]);

/**
 * Look up DB-stored provider credentials for the project and inject them into
 * `ModelSettings.providerOptions` so `ModelFactory.createModel` uses them.
 *
 * Precedence: DB credentials override env. If no DB credential exists for the
 * resolved provider, the input is returned unchanged so the existing env-based
 * fallback in the AI SDK still works.
 */
export async function resolveModelSettingsWithDbCredentials(params: {
  db: AgentsManageDatabaseClient;
  scopes: ProjectScopeConfig;
  modelSettings: ModelSettings;
}): Promise<ModelSettings> {
  const { db, scopes, modelSettings } = params;
  if (!modelSettings?.model) return modelSettings;

  let provider: string;
  try {
    provider = ModelFactory.parseModelString(modelSettings.model).provider;
  } catch {
    return modelSettings;
  }

  if (!PROVIDERS_WITH_DB_CREDENTIALS.has(provider)) {
    return modelSettings;
  }

  const existingOptions = modelSettings.providerOptions ?? {};
  if (typeof existingOptions.apiKey === 'string' && existingOptions.apiKey.length > 0) {
    return modelSettings;
  }

  const decrypted = await getProviderCredentialDecrypted(db)({
    scopes,
    provider: provider as 'anthropic' | 'openai' | 'google' | 'openrouter' | 'custom',
  });
  if (!decrypted) return modelSettings;

  const merged: Record<string, unknown> = { ...existingOptions, apiKey: decrypted.apiKey };
  if (decrypted.baseUrl && !existingOptions.baseUrl && !existingOptions.baseURL) {
    merged.baseURL = decrypted.baseUrl;
  }

  return {
    ...modelSettings,
    providerOptions: merged,
  };
}

/**
 * Returns the set of providers a project is allowed to use, derived from the
 * DB-backed credentials plus any provider whose env var is set (fallback path).
 */
export async function getUsableProviders(params: {
  db: AgentsManageDatabaseClient;
  scopes: ProjectScopeConfig;
}): Promise<string[]> {
  const { db, scopes } = params;
  const result = new Set<string>();

  for (const provider of PROVIDERS_WITH_DB_CREDENTIALS) {
    const cred = await getProviderCredentialDecrypted(db)({
      scopes,
      provider: provider as 'anthropic' | 'openai' | 'google' | 'openrouter' | 'custom',
    });
    if (cred) result.add(provider);
  }

  if (process.env.ANTHROPIC_API_KEY) result.add('anthropic');
  if (process.env.OPENAI_API_KEY) result.add('openai');
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) result.add('google');
  if (process.env.OPENROUTER_API_KEY) result.add('openrouter');

  return Array.from(result);
}
