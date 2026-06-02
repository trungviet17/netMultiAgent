import { getProviderCredentialDecrypted } from '../data-access/runtime/providerCredentials';
import type { AgentsRunDatabaseClient } from '../db/runtime/runtime-client';
import type { Models, TenantScopeConfig } from '../types/index';
import type { ModelSettings } from '../validation/schemas';
import { getLogger } from './logger';
import { ModelFactory } from './model-factory';

const logger = getLogger('ModelCredentialsResolver');

const PROVIDERS_WITH_DB_CREDENTIALS = new Set([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'custom',
]);

const PROVIDERS_WITH_BASE_URL = new Set(['openrouter', 'custom']);

/**
 * Look up DB-stored provider credentials for the project and inject them into
 * `ModelSettings.providerOptions` so `ModelFactory.createModel` uses them.
 *
 * Single source of truth: when a DB credential exists, its apiKey and baseUrl
 * win over any value present in `providerOptions`. This lets project configs
 * stay terse (`model: "custom/openai/gpt-5.1"`) while the credential row owns
 * the endpoint. Saves users from having to repeat baseURL on every model slot
 * and prevents stale sub-agent overrides from breaking custom providers.
 *
 * If no DB credential exists for the resolved provider, the input is returned
 * unchanged so the existing env-based fallback in the AI SDK still works.
 */
export async function resolveModelSettingsWithDbCredentials(params: {
  db: AgentsRunDatabaseClient;
  scopes: TenantScopeConfig;
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
  const hasExplicitApiKey =
    typeof existingOptions.apiKey === 'string' && existingOptions.apiKey.length > 0;

  // Short-circuit only if neither baseURL nor apiKey would change. For providers with
  // a credential-owned baseUrl (custom, openrouter) we still need to run even if the
  // caller passed an explicit apiKey, because we may have to override the baseURL.
  if (hasExplicitApiKey && !PROVIDERS_WITH_BASE_URL.has(provider)) {
    return modelSettings;
  }

  // Best-effort lookup: a DB error (table not yet migrated, transient failure) must NOT
  // break generation. Fall back to the unchanged settings so the AI SDK's env-based path
  // still applies. Only an actual stored credential should override config.
  let decrypted: { apiKey: string; baseUrl: string | null } | null = null;
  try {
    decrypted = await getProviderCredentialDecrypted(db)({
      scopes,
      provider: provider as 'anthropic' | 'openai' | 'google' | 'openrouter' | 'custom',
    });
  } catch (err) {
    logger.warn(
      { provider, err: err instanceof Error ? err.message : String(err) },
      'Provider credential lookup failed; falling back to config/env credentials'
    );
    return modelSettings;
  }
  if (!decrypted) return modelSettings;

  const merged: Record<string, unknown> = { ...existingOptions };
  if (!hasExplicitApiKey) {
    merged.apiKey = decrypted.apiKey;
  }

  if (PROVIDERS_WITH_BASE_URL.has(provider) && decrypted.baseUrl) {
    const previousBase = existingOptions.baseURL ?? existingOptions.baseUrl;
    if (previousBase && previousBase !== decrypted.baseUrl) {
      logger.debug(
        { provider, previousBase, credentialBase: decrypted.baseUrl },
        'Overriding model baseURL with provider credential value'
      );
    }
    merged.baseURL = decrypted.baseUrl;
    delete merged.baseUrl;
  }

  return {
    ...modelSettings,
    providerOptions: merged,
  };
}

/**
 * Resolve DB credentials for every populated slot of a `Models` config
 * (`base`, `structuredOutput`, `summarizer`) in one shot.
 *
 * The agent runtime builds models for far more than the primary generation call:
 * summarization, mid-generation compression, conversation-history distillation,
 * structured-output, status updates, and evals each turn a `ModelSettings` into a
 * provider via `ModelFactory`. Those paths read the raw project/agent config, which
 * for `custom`/`openrouter` providers deliberately omits `baseURL`/`apiKey` (the
 * credential row owns them). Resolving the whole `Models` object once — at the point
 * the effective config is assembled — guarantees ALL of those paths get the same
 * injected credential, instead of only the primary model. Without this, secondary
 * paths throw "Custom provider requires configuration. Please provide baseURL...".
 *
 * Undefined slots stay undefined. Returns `undefined` only if `models` is undefined.
 */
export async function resolveModelsWithDbCredentials(params: {
  db: AgentsRunDatabaseClient;
  scopes: TenantScopeConfig;
  models: Models | undefined;
}): Promise<Models | undefined> {
  const { db, scopes, models } = params;
  if (!models) return models;

  const resolveSlot = (slot: ModelSettings | undefined) =>
    slot ? resolveModelSettingsWithDbCredentials({ db, scopes, modelSettings: slot }) : undefined;

  const [base, structuredOutput, summarizer] = await Promise.all([
    resolveSlot(models.base),
    resolveSlot(models.structuredOutput),
    resolveSlot(models.summarizer),
  ]);

  const resolved: Models = {};
  if (base) resolved.base = base;
  if (structuredOutput) resolved.structuredOutput = structuredOutput;
  if (summarizer) resolved.summarizer = summarizer;
  return resolved;
}

/**
 * Returns the set of providers a project is allowed to use, derived from the
 * DB-backed credentials plus any provider whose env var is set (fallback path).
 */
export async function getUsableProviders(params: {
  db: AgentsRunDatabaseClient;
  scopes: TenantScopeConfig;
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
