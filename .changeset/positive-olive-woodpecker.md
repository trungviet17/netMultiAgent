---
"@inkeep/agents-core": minor
---

Make LLM provider credentials tenant/org-wide instead of per-project. Credentials now live in the runtime (Postgres) database keyed by `(tenantId, id)` — not the per-project-branched config DB — so one set of keys is shared across all projects and resolved consistently at runtime. Adds a runtime migration creating `provider_credentials` and a manage migration dropping the old project-scoped table.
