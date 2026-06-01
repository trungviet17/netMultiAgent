---
"@inkeep/agents-core": patch
"@inkeep/agents-api": patch
---

Fix custom provider authentication and credential resolution.

- The `custom` (OpenAI-compatible) provider no longer lets the legacy `CUSTOM_LLM_API_KEY` environment variable shadow an explicit per-credential `apiKey`. The env var is now only a fallback when no credential apiKey is supplied; previously it was injected as an `Authorization` header that overrode the credential key (e.g. an OpenRouter env key getting sent to a custom gateway), causing upstream authentication failures.
- Inject DB-backed provider credentials into every model slot (base, structured-output, summarizer) and the status-update/eval paths, not just the primary generation model. Fixes custom and OpenRouter providers failing in summarization, compression, conversation-history distillation, structured output, status updates, and evals with "Custom provider requires configuration".
- Credential lookup is now best-effort: a database error (e.g. table not yet migrated) falls back to existing config/env credentials instead of failing generation.
