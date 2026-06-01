import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the config handed to createOpenAICompatible so we can assert which API key
// ends up authenticating the request to a custom OpenAI-compatible gateway.
const refs = vi.hoisted(() => ({ capturedConfig: null as any }));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (cfg: any) => {
    refs.capturedConfig = cfg;
    return {
      languageModel: (modelId: string) => ({
        specificationVersion: 'v2',
        provider: 'custom',
        modelId,
      }),
    };
  },
}));

// Avoid pulling the real wrapLanguageModel validation into this unit test.
vi.mock('ai', () => ({
  wrapLanguageModel: ({ model }: any) => model,
}));

import { ModelFactory } from '../../utils/model-factory';

describe('ModelFactory custom provider credential precedence', () => {
  beforeEach(() => {
    refs.capturedConfig = null;
    delete process.env.CUSTOM_LLM_API_KEY;
  });
  afterEach(() => {
    delete process.env.CUSTOM_LLM_API_KEY;
  });

  it('uses the explicit credential apiKey and does NOT let the env key shadow it', () => {
    // Regression: an OpenRouter env key was overriding a custom (netMind) DB credential
    // because @ai-sdk/openai-compatible spreads headers after the apiKey-derived header.
    process.env.CUSTOM_LLM_API_KEY = 'sk-or-env-should-not-win';

    ModelFactory.createModel({
      model: 'custom/Qwen/Qwen3.5-35B-A3B-FP8',
      providerOptions: {
        baseURL: 'https://netmind.example/gateway/v1',
        apiKey: 'sk-credential-wins',
      },
    });

    expect(refs.capturedConfig.apiKey).toBe('sk-credential-wins');
    // No Authorization header injected, so the SDK authenticates with apiKey (the credential).
    expect(refs.capturedConfig.headers?.Authorization).toBeUndefined();
  });

  it('falls back to the env key as Authorization when no credential apiKey is present', () => {
    process.env.CUSTOM_LLM_API_KEY = 'sk-env-fallback';

    ModelFactory.createModel({
      model: 'custom/some-model',
      providerOptions: { baseURL: 'https://gw.example/v1' },
    });

    expect(refs.capturedConfig.headers?.Authorization).toBe('Bearer sk-env-fallback');
    expect(refs.capturedConfig.apiKey).toBeUndefined();
  });

  it('injects no Authorization and no apiKey when neither credential nor env is set', () => {
    ModelFactory.createModel({
      model: 'custom/some-model',
      providerOptions: { baseURL: 'https://gw.example/v1' },
    });

    expect(refs.capturedConfig.headers?.Authorization).toBeUndefined();
    expect(refs.capturedConfig.apiKey).toBeUndefined();
  });
});
