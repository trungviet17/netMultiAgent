import type { ProviderCredentialProvider } from '../validation/schemas';

export type TestConnectionResult = {
  success: boolean;
  message: string;
  latencyMs?: number;
};

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function summarizeError(status: number, body: string): string {
  const trimmed = body.trim().slice(0, 240);
  if (status === 401 || status === 403) {
    return `Authentication failed (${status}). ${trimmed}`;
  }
  if (status === 429) {
    return `Rate limit reached (${status}). Key looks valid. ${trimmed}`;
  }
  return `HTTP ${status}: ${trimmed || 'request failed'}`;
}

async function testAnthropic(apiKey: string): Promise<TestConnectionResult> {
  const url = 'https://api.anthropic.com/v1/messages';
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    const latencyMs = Date.now() - start;
    if (res.ok || res.status === 429) {
      return { success: true, message: 'Anthropic API key is valid', latencyMs };
    }
    if (res.status === 400) {
      // 400 from messages API with an invalid model name still means auth succeeded.
      return {
        success: true,
        message: 'Anthropic API key is valid (model rejected probe)',
        latencyMs,
      };
    }
    const body = await res.text();
    return { success: false, message: summarizeError(res.status, body), latencyMs };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

async function testOpenAI(apiKey: string, baseUrl?: string): Promise<TestConnectionResult> {
  const base = (baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = `${base}/models`;
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const latencyMs = Date.now() - start;
    if (res.ok) return { success: true, message: 'OpenAI API key is valid', latencyMs };
    const body = await res.text();
    return { success: false, message: summarizeError(res.status, body), latencyMs };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

async function testGoogle(apiKey: string): Promise<TestConnectionResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' });
    const latencyMs = Date.now() - start;
    if (res.ok) return { success: true, message: 'Google Generative AI key is valid', latencyMs };
    const body = await res.text();
    return { success: false, message: summarizeError(res.status, body), latencyMs };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

async function testOpenRouter(apiKey: string): Promise<TestConnectionResult> {
  const url = 'https://openrouter.ai/api/v1/auth/key';
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const latencyMs = Date.now() - start;
    if (res.ok) return { success: true, message: 'OpenRouter API key is valid', latencyMs };
    const body = await res.text();
    return { success: false, message: summarizeError(res.status, body), latencyMs };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

async function testCustom(apiKey: string, baseUrl: string): Promise<TestConnectionResult> {
  const base = baseUrl.replace(/\/+$/, '');
  const url = `${base}/models`;
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const latencyMs = Date.now() - start;
    if (res.ok) return { success: true, message: 'Custom endpoint responded OK', latencyMs };
    const body = await res.text();
    return { success: false, message: summarizeError(res.status, body), latencyMs };
  } catch (err) {
    return { success: false, message: `Could not reach ${url}: ${(err as Error).message}` };
  }
}

export async function testProviderConnection(params: {
  provider: ProviderCredentialProvider;
  apiKey: string;
  baseUrl?: string;
}): Promise<TestConnectionResult> {
  switch (params.provider) {
    case 'anthropic':
      return testAnthropic(params.apiKey);
    case 'openai':
      return testOpenAI(params.apiKey, params.baseUrl);
    case 'google':
      return testGoogle(params.apiKey);
    case 'openrouter':
      return testOpenRouter(params.apiKey);
    case 'custom': {
      if (!params.baseUrl) {
        return { success: false, message: 'baseUrl is required for custom providers' };
      }
      return testCustom(params.apiKey, params.baseUrl);
    }
    default:
      return { success: false, message: `Unsupported provider: ${params.provider}` };
  }
}
