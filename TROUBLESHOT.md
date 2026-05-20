# Troubleshooting

Các lỗi đã gặp trong quá trình chạy `activities-planner` trên local stack (`pnpm dev`), kèm cách chẩn đoán và fix. Đọc theo thứ tự — lỗi sau thường chỉ lộ ra sau khi đã giải quyết lỗi trước.

## Quy tắc chung khi debug chat playground

- Luôn mở tab `agents-api` trong `mprocs` (port 3002). 90% câu trả lời nằm ở đó.
- Sửa `.env` → **bắt buộc** restart `pnpm dev` (Node không hot-reload `.env`).
- Sửa model trong `src/projects/<name>/index.ts` → **bắt buộc** `inkeep push` trong thư mục project. Không cần restart agents-api (config đọc từ DB).
- Lỗi *"Authentication failed. Please try again."* trong chat UI = response **401** từ agents-api. Đó là string hardcoded trong embedded chat UI cho status 401.
- Lỗi *"Hmm.. It seems I might be having some issues right now. Please clear the chat and try again."* = LLM call thất bại 3 lần liên tiếp (sau khi đã qua auth). Tìm log `callLlmStep`, `executeToolStep`, hoặc `No response from agent` với `errorDetails` đi kèm.

## 1. `inkeep push` báo `401 / An internal server error occurred`

### Triệu chứng

```
Using profile: cloud
  Remote: https://api.agents.inkeep.com
  Environment: production
  Auth: not authenticated
...
ERROR (projectFullClient): Failed to update project via API
    status: 401
```

### Nguyên nhân

CLI `inkeep` dùng profile lưu ở `~/.inkeep/profiles.yaml`, **độc lập** với `src/inkeep.config.ts`. Profile mặc định là `cloud` — trỏ vào `api.agents.inkeep.com` của Inkeep mà bạn chưa login → 401.

### Fix

Tạo profile `local` trỏ về `pnpm dev` của bạn và set làm active. Sửa `~/.inkeep/profiles.yaml`:

```yaml
activeProfile: local
profiles:
  local:
    remote:
      api: http://127.0.0.1:3002
      manageUi: http://localhost:3000
    credential: inkeep-local
    environment: development
  cloud:
    remote: cloud
    credential: inkeep-cloud
    environment: production
```

`credential: inkeep-local` không tồn tại trong keychain — đó là cố ý: CLI sẽ fallback sang `apiKey` ở `src/inkeep.config.ts` (chính là `INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET`), và agents-api ở local nhận bypass này.

Verify:

```bash
inkeep profile list                                # phải thấy * local
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/health  # phải 204
cd src/projects/activities-planner && inkeep push  # phải success
```

Sau này muốn đổi: `inkeep profile use cloud` / `inkeep profile use local`.

## 2. Chat trả 404 `Conversation not found`

### Triệu chứng

Log `agents-api`:
```
GET /manage/tenants/default/projects/.../conversations/<id>/bounds → 404
```

### Nguyên nhân

Playground lưu `conversationId` trong `localStorage` của trình duyệt. Sau khi `pnpm db:drop` / `setup-dev` lại / xoá volume Postgres, row conversation biến mất nhưng browser vẫn nhớ ID cũ → 404 khi UI gọi `/bounds` lúc mở lại.

### Fix

- DevTools (Cmd+Opt+I) → tab **Application** → **Clear site data** cho `localhost:3000`.
- Hard reload Cmd+Shift+R.
- Tạo conversation mới trong playground.

Đây là vấn đề state phía client, không phải bug code.

## 3. Chat báo `Authentication failed. Please try again.` (401)

### Triệu chứng

Embedded chat UI hiển thị đúng câu này. Trong log `agents-api` thấy 401 trên một endpoint dưới `/run/...` hoặc `/manage/.../playground/token`.

### Nguyên nhân

Cột `apps.app_playground.config.webClient.publicKeys` trong **Run DB (Postgres)** trống. Flow đáng lẽ là:

1. agents-api khởi động → hàm `ensurePlaygroundAppConfig()` đọc `INKEEP_AGENTS_TEMP_JWT_PUBLIC_KEY` từ env, derive `kid`, upsert vào `apps.app_playground.config.webClient.publicKeys`.
2. UI gọi `/manage/tenants/<t>/playground/token` → API ký JWT với `private key` tương ứng, gắn `kid` trong header.
3. Chat gửi JWT với header `kid`. Middleware `runApiKeyAuth` tìm `kid` trong `publicKeys` của app → verify chữ ký.

**Quirk của quickstart workspace này:** [apps/agents-api/src/index.ts](../apps/agents-api/src/index.ts) dùng `createAgentsApp` từ `@inkeep/agents-api/factory`, **không kích hoạt** startup hook đó (hook chỉ chạy trong entry bundled `dist/index.js`). Hậu quả: `publicKeys` luôn rỗng → tất cả JWT từ playground đều fail verify → 401 → chat UI hiển thị "Authentication failed".

### Fix

Đã có sẵn `pnpm seed-playground` trong [package.json](../package.json) gọi [scripts/seed-playground-keys.ts](../scripts/seed-playground-keys.ts) — script này load env rồi gọi `ensurePlaygroundAppConfig()` đúng cách.

```bash
pnpm seed-playground
```

Verify:

```bash
docker exec -i -e PGPASSWORD=password my-agents-postgres-db-1 \
  psql -h 127.0.0.1 -U appuser -d inkeep_agents \
  -c "SELECT jsonb_pretty(config::jsonb) FROM apps WHERE id='app_playground';"
```

`publicKeys` phải có ít nhất 1 entry với `kid: pg-...` và `algorithm: RS256`.

### Khi nào phải chạy lại

- Sau `pnpm setup-dev` / `pnpm setup-dev:cloud`.
- Sau `pnpm db:drop` + `pnpm db:migrate` + `pnpm db:auth:init`.
- Sau `pnpm generate-jwt-keys` (đổi cặp khoá).
- Sau khi xoá row `app_playground` thủ công.

### Phụ: nếu vẫn 401 sau khi seed

Kiểm tra theo thứ tự:

1. `INKEEP_AGENTS_TEMP_JWT_PRIVATE_KEY` và `INKEEP_AGENTS_TEMP_JWT_PUBLIC_KEY` trong `.env` phải là **một cặp**. Nếu nghi ngờ, chạy `pnpm generate-jwt-keys` tạo cặp mới, paste cả 2 vào `.env`, rồi `pnpm seed-playground`.
2. Admin user tồn tại: `pnpm db:auth:init` (idempotent).
3. Browser session hợp lệ: Clear site data `localhost:3000`, login lại.

## 4. Chat fail với `Custom provider requires configuration. Please provide baseURL in providerOptions.baseURL`

### Triệu chứng

Log `agents-api`:
```
ERROR (...): No response from agent <id> on iteration N (error N/3)
errorDetails: {
  "code": -32603,
  "message": "Custom provider requires configuration. Please provide baseURL in providerOptions.baseURL",
  ...
}
```

3 lần lặp lại → "Maximum error limit (3) reached" → UI hiển thị "Hmm.. it seems I might be having some issues".

### Nguyên nhân

`ModelFactory` thấy provider `custom` nhưng `providerConfig` rỗng (`extractProviderConfig` không tìm được `baseURL/baseUrl` trong `providerOptions`).

Hai chỗ có thể thiếu `providerOptions`:

- **Project-level models** trong `src/projects/<name>/index.ts` — bạn quên `providerOptions: { baseURL: ... }` cạnh `model: 'custom/...'`.
- **Sub-agent-level models** trong bảng `sub_agents` (Manage DB / DoltgreSQL). Sub-agent có `models` riêng → **override** project models. Override này thường thiếu `providerOptions` khi được set qua Visual Builder UI.

### Fix

#### Bước 1: kiểm tra project-level

```bash
docker exec -i -e PGPASSWORD=password my-agents-doltgres-db-1 \
  psql -h 127.0.0.1 -U appuser \
  -d "inkeep_agents/default_activities-planner_main" \
  -c "SELECT id, models FROM projects WHERE id='activities-planner';"
```

Lưu ý: DoltgreSQL dùng **per-project branch** — tên DB phải là `inkeep_agents/default_<projectId>_main`, không phải chỉ `inkeep_agents`. Trên `default_main` bảng `projects` sẽ rỗng — đó là bình thường.

Field `models` phải có `providerOptions.baseURL` cho mỗi `base/structuredOutput/summarizer` dùng `custom/...`. Ví dụ đúng:

```json
{
  "base": {
    "model": "custom/openai/gpt-5.1",
    "providerOptions": {"baseURL": "https://openrouter.ai/api/v1"}
  },
  "structuredOutput": {
    "model": "custom/openai/gpt-5-mini",
    "providerOptions": {"baseURL": "https://openrouter.ai/api/v1"}
  },
  "summarizer": {
    "model": "custom/openai/gpt-4.1-nano",
    "providerOptions": {"baseURL": "https://openrouter.ai/api/v1"}
  }
}
```

Nếu thiếu — sửa [src/projects/activities-planner/index.ts](../src/projects/activities-planner/index.ts) và `inkeep push`.

#### Bước 2: kiểm tra sub-agent override

```bash
docker exec -i -e PGPASSWORD=password my-agents-doltgres-db-1 \
  psql -h 127.0.0.1 -U appuser \
  -d "inkeep_agents/default_activities-planner_main" \
  -c "SELECT id, models FROM sub_agents WHERE project_id='activities-planner';"
```

Nếu bất kỳ row nào có `models` non-null với `custom/...` mà thiếu `providerOptions` → clear nó để fall back về project models:

```bash
docker exec -i -e PGPASSWORD=password my-agents-doltgres-db-1 \
  psql -h 127.0.0.1 -U appuser \
  -d "inkeep_agents/default_activities-planner_main" \
  -c "UPDATE sub_agents SET models=NULL WHERE project_id='activities-planner' AND models IS NOT NULL;"
```

### Khuyến nghị tránh tái phát

- Quản model trong TS code, không qua Visual Builder UI cho project dùng `custom/` provider. Visual Builder ghi vào `sub_agents.models` và dễ thiếu `providerOptions`.
- Nếu cần sub-agent dùng model riêng, set trong TS với đầy đủ providerOptions:
  ```ts
  const cheapAgent = subAgent({
    id: 'cheap-agent',
    model: {
      model: 'custom/openai/gpt-4.1-nano',
      providerOptions: { baseURL: CUSTOM_BASE_URL },
    },
    // ...
  });
  ```

## 5. Model ID không hợp lệ trên OpenRouter

### Triệu chứng

Khi gọi LLM, trong log có message kiểu `<model-id> is not a valid model ID` hoặc HTTP 400 từ provider.

### Nguyên nhân

Model ID phía sau `custom/` phải **đúng** theo provider mà `CUSTOM_LLM_BASE_URL` trỏ tới. OpenRouter có catalog riêng, không phải mọi tên OpenAI đều có (vd: không có `openai/gpt-5.1-mini`, chỉ có `openai/gpt-5-mini` hoặc `openai/gpt-5.4-mini`).

### Fix

Probe trực tiếp endpoint với key của bạn trước khi đặt vào project:

```bash
KEY=$(grep ^CUSTOM_LLM_API_KEY= .env | cut -d= -f2-)
URL=$(grep ^CUSTOM_LLM_BASE_URL= .env | cut -d= -f2-)

# Test 1 model
curl -s "$URL/chat/completions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-5.1","messages":[{"role":"user","content":"hi"}],"max_tokens":32}'

# Liệt kê toàn bộ catalog (OpenRouter)
curl -s "$URL/models" -H "Authorization: Bearer $KEY" \
  | python3 -c "import json,sys; [print(m['id']) for m in json.load(sys.stdin).get('data',[])]"
```

Cập nhật trong [src/projects/activities-planner/index.ts](../src/projects/activities-planner/index.ts) rồi `inkeep push`.

## 6. Log `agents-api` báo 500 trên `/manage/tenants/.../signoz/query`

### Triệu chứng

```
ERROR (agents-api): Request completed
  url: "/manage/tenants/default/signoz/query"
  status: 500
```

### Nguyên nhân

Manage UI gọi SigNoz observability để hiển thị traces. Không có SigNoz chạy → 500. **Không ảnh hưởng chat.**

### Fix

Bỏ qua. Hoặc bật SigNoz qua `pnpm setup-dev:optional` nếu cần observability.

## Quick reference: lệnh chẩn đoán

```bash
# Profile CLI hiện tại
inkeep profile list

# Health checks
curl -s -o /dev/null -w "agents-api: %{http_code}\n" http://127.0.0.1:3002/health
curl -s -o /dev/null -w "manage-ui:  %{http_code}\n" http://localhost:3000/

# Login admin (verify Better Auth + user provisioning)
PASS=$(grep ^INKEEP_AGENTS_MANAGE_UI_PASSWORD= .env | cut -d= -f2-)
curl -s -X POST http://127.0.0.1:3002/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@example.com\",\"password\":\"$PASS\"}" | head -c 200

# Playground token (verify session + permission + JWT signing)
SESSION=$(curl -s -X POST http://127.0.0.1:3002/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@example.com\",\"password\":\"$PASS\"}" \
  -D - 2>&1 | grep -i "set-cookie: better-auth.session_token=" \
  | sed -E 's/.*session_token=([^;]+).*/\1/')
curl -s -X POST http://127.0.0.1:3002/manage/tenants/default/playground/token \
  -H 'Content-Type: application/json' -H "Cookie: better-auth.session_token=$SESSION" \
  -d '{"projectId":"activities-planner","agentId":"activities-planner"}'

# Inspect DBs
docker exec -i -e PGPASSWORD=password my-agents-postgres-db-1 \
  psql -h 127.0.0.1 -U appuser -d inkeep_agents \
  -c "SELECT jsonb_pretty(config::jsonb) FROM apps WHERE id='app_playground';"

docker exec -i -e PGPASSWORD=password my-agents-doltgres-db-1 \
  psql -h 127.0.0.1 -U appuser \
  -d "inkeep_agents/default_activities-planner_main" \
  -c "SELECT id, models FROM projects WHERE id='activities-planner';
      SELECT id, models FROM sub_agents WHERE project_id='activities-planner';"
```
