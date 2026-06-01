# Hướng dẫn xử lý Config Model & Thêm mô hình mới vào Inkeep

Tài liệu này mô tả chi tiết kiến trúc xử lý cấu hình mô hình (LLM model configuration) trong hệ thống Inkeep Agents Framework, bao gồm cách phân giải mô hình tại runtime, cơ chế kế thừa cấu hình, quản lý credentials, và hướng dẫn từng bước để thêm một provider/mô hình mới vào hệ thống.

---

## 1. Tổng quan kiến trúc

Hệ thống Inkeep hỗ trợ đa provider (multi-provider) cho LLM thông qua **Vercel AI SDK**. Mỗi project/agent/sub-agent có thể cấu hình riêng các mô hình khác nhau cho các mục đích sử dụng khác nhau.

### 1.1. Ba loại model "slot"

Mỗi cấp độ cấu hình (project, agent, sub-agent) có thể định nghĩa 3 model slot:

| Slot | Mục đích | Bắt buộc |
|------|----------|----------|
| `base` | Mô hình chính dùng để sinh response của agent | Bắt buộc ở project-level |
| `structuredOutput` | Mô hình dùng cho data components / structured output. Fallback về `base` nếu không set | Tùy chọn |
| `summarizer` | Mô hình dùng cho tóm tắt hội thoại (thường là model nhỏ hơn). Fallback về `base` | Tùy chọn |

Định nghĩa tại [packages/agents-mcp/src/models/model.ts](../packages/agents-mcp/src/models/model.ts).

### 1.2. Cấu trúc `ModelSettings`

```typescript
type ModelSettings = {
  model: string;                       // Format: "provider/model-id" (vd: "anthropic/claude-sonnet-4-5")
  providerOptions?: Record<string, unknown>;  // Tham số runtime cho provider (temperature, maxTokens, apiKey, baseURL, ...)
  fallbackModels?: string[];           // Danh sách model fallback khi gọi qua Gateway
  allowedProviders?: string[];         // Whitelist provider khi gọi qua Gateway
};
```

Schema validate đầy đủ ở [packages/agents-core/src/validation/schemas.ts:211-246](../packages/agents-core/src/validation/schemas.ts#L211-L246).

---

## 2. Cơ chế kế thừa cấu hình (Inheritance Hierarchy)

Khi runtime cần resolve mô hình cho một sub-agent, hệ thống đi theo thứ tự ưu tiên từ cao xuống thấp:

```
Sub-Agent.models  ──►  Agent.models  ──►  Project.models  ──►  Throw error nếu thiếu `base`
```

Cài đặt cụ thể ở [agents-api/src/domains/run/utils/model-resolver.ts](../agents-api/src/domains/run/utils/model-resolver.ts).

### 2.1. Quy tắc resolve theo slot

- Khi tìm `structuredOutput`, hệ thống tìm slot `structuredOutput` từ sub-agent → agent → project. Nếu không có ở cấp nào, fallback sang `base` (cũng theo thứ tự đó).
- Tương tự cho `summarizer`.
- `base` phải tồn tại ở ít nhất một cấp, nếu không sẽ throw error.

### 2.2. Kế thừa các "gateway fields"

Hai trường `fallbackModels` và `allowedProviders` được kế thừa độc lập với `model`:

- Nếu sub-agent có `model` nhưng KHÔNG có `fallbackModels`, hệ thống lấy `fallbackModels` từ agent → project.
- Cho phép override granular: agent có thể đổi model nhưng giữ nguyên cấu hình gateway của project.

### 2.3. Schema khác biệt giữa các cấp

| Cấp | Schema | `base` bắt buộc? |
|-----|--------|------------------|
| Project | `ProjectModelSchema` | ✅ |
| Agent | `ModelSchema` | ❌ |
| Sub-Agent | `ModelSchema` | ❌ |

---

## 3. Phân giải mô hình tại runtime

### 3.1. Pipeline xử lý

Khi một request đi vào để generate response, flow xử lý như sau:

```
Request
   │
   ▼
resolveModelConfig()       ← Đi qua hierarchy, chọn ModelSettings
   │
   ▼
getPrimaryModel() / getStructuredOutputModel() / getSummarizerModel()
   │
   ▼
configureModelSettings()   ← Inject DB credentials vào providerOptions.apiKey
   │
   ▼
ModelFactory.createModel() ← Tạo provider instance qua AI SDK
   │
   ▼
streamText() / generateText() (Vercel AI SDK)
```

File điều phối chính: [agents-api/src/domains/run/agents/generation/model-config.ts](../agents-api/src/domains/run/agents/generation/model-config.ts).

### 3.2. `ModelFactory` — trái tim của việc khởi tạo model

File: [packages/agents-core/src/utils/model-factory.ts](../packages/agents-core/src/utils/model-factory.ts).

Ba method quan trọng:

#### `parseModelString(modelString)`
Tách chuỗi `"provider/model-id"` thành `{ provider, model }`.
- Hỗ trợ các provider: `anthropic`, `azure`, `openai`, `google`, `openrouter`, `gateway`, `nim`, `custom`, `mock`.
- Throw error nếu format sai.

#### `createProvider(provider, config)`
Tạo instance provider từ các package `@ai-sdk/*`:
- `@ai-sdk/anthropic` → `createAnthropic()`
- `@ai-sdk/openai` → `createOpenAI()`
- `@ai-sdk/google` → `createGoogleGenerativeAI()`
- `@ai-sdk/azure` → `createAzure()` (cần `resourceName` hoặc `baseURL`)
- `@ai-sdk/openai-compatible` → cho `nim`, `custom`

#### `createModel(config)`
- Parse model string.
- Quyết định có route qua **Gateway** hay không (dựa trên env var và provider).
- Khởi tạo provider, lấy model instance.
- Wrap với `gatewayCostMiddleware` để tracking chi phí.

### 3.3. Tách `providerOptions` thành 2 loại

`extractProviderConfig()` chia `providerOptions` thành:

- **Constructor-level options** (truyền vào lúc `createProvider`): `baseURL`, `headers`, `resourceName`, `apiVersion`, `apiKey`.
- **Per-call options** (truyền vào lúc gọi generate): tham số runtime như `temperature`, `topP`, `maxOutputTokens`.

---

## 4. Quản lý Provider Credentials

Tính năng credentials cho phép lưu API key của các provider một cách an toàn vào database, override env var, và quản lý qua UI/API.

### 4.1. Database schema

Bảng `provider_credentials` định nghĩa tại [packages/agents-core/src/db/manage/manage-schema.ts:752-781](../packages/agents-core/src/db/manage/manage-schema.ts#L752-L781):

| Cột | Mô tả |
|-----|-------|
| `tenantId`, `projectId`, `id` | Composite primary key |
| `provider` | Tên provider (anthropic, openai, …) |
| `label` | Nhãn user-friendly |
| `baseUrl` | (Optional) endpoint tuỳ chỉnh |
| `encryptedKey`, `encryptionIv`, `authTag` | API key đã mã hoá AES-256-GCM |
| `keyFingerprint` | SHA-256 prefix 16 ký tự để verify trùng key |
| `enabled` | Bật/tắt credential |
| `lastTestStatus`, `lastTestMessage`, `lastTestAt` | Kết quả test gần nhất |
| `createdBy` | Audit user |

### 4.2. Mã hoá

File: [packages/agents-core/src/utils/secret-encryption.ts](../packages/agents-core/src/utils/secret-encryption.ts).

- **Thuật toán:** AES-256-GCM.
- **Key:** lấy từ env `INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY` (32 bytes, hex hoặc base64).
- **IV:** 12 bytes random mỗi lần encrypt.
- **Auth tag:** 16 bytes để verify integrity.
- `maskSecret()` hiển thị `xxxx••••xxxx` cho UI.

### 4.3. Provider được hỗ trợ credential

```typescript
ProviderCredentialProviders = ['anthropic', 'openai', 'google', 'openrouter', 'custom']
```
([schemas.ts:2321-2328](../packages/agents-core/src/validation/schemas.ts#L2321-L2328))

### 4.4. Resolver inject credentials vào model

File: [packages/agents-core/src/utils/model-credentials-resolver.ts](../packages/agents-core/src/utils/model-credentials-resolver.ts).

`resolveModelSettingsWithDbCredentials()`:
- Tra DB lấy credential decrypted theo `(projectId, provider)`.
- **Precedence:** DB credentials > environment variables.
- Merge với `providerOptions` hiện có; **không** override nếu user đã explicit set `apiKey` ở providerOptions.

`getUsableProviders()`:
- Trả về tập provider có thể sử dụng (có credential trong DB **hoặc** env var như `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …).

### 4.5. REST API quản lý credentials

File: [agents-api/src/domains/manage/routes/providerCredentials.ts](../agents-api/src/domains/manage/routes/providerCredentials.ts).

| Method | Path | Mục đích |
|--------|------|----------|
| `GET` | `/provider-credentials` | List |
| `GET` | `/provider-credentials/{id}` | Get one |
| `POST` | `/provider-credentials` | Create (encrypt + store) |
| `PATCH` | `/provider-credentials/{id}` | Update (optional re-encrypt) |
| `POST` | `/provider-credentials/{id}/test` | Test connection |
| `DELETE` | `/provider-credentials/{id}` | Delete |

### 4.6. Transient apiKey injection

Commit `ae55eccfd` (`feat: allow apiKey in provider options for transient runtime injection`) cho phép inject `apiKey` trực tiếp vào `providerOptions` lúc runtime mà KHÔNG persist vào DB. Hữu ích cho:
- Test ad-hoc với key khác.
- Multi-tenant scenarios truyền key per-request.

---

## 5. Danh sách Provider & Model hiện hỗ trợ

Định nghĩa tại [packages/agents-core/src/constants/models.ts](../packages/agents-core/src/constants/models.ts):

### Anthropic
- Claude Opus / Sonnet / Haiku (nhiều version)

### OpenAI
- GPT-5.x, GPT-4.x, o3 series

### Google
- Gemini 2.5 / 3.x series

### Khác
- `openrouter` — proxy multi-provider
- `azure` — Azure OpenAI (cần `resourceName` hoặc `baseURL`)
- `nim` — NVIDIA NIM (OpenAI-compatible)
- `custom` — bất kỳ endpoint OpenAI-compatible nào
- `gateway` — Inkeep gateway routing
- `mock` — dùng cho test

`GATEWAY_ROUTABLE_PROVIDERS_SET = { anthropic, openai, google }`.

### Default model presets (UI)

File: [agents-manage-ui/src/components/agent/configuration/model-options.tsx](../agents-manage-ui/src/components/agent/configuration/model-options.tsx).

| Provider | Base | Structured Output | Summarizer |
|----------|------|-------------------|------------|
| Anthropic | `claude-sonnet-4-5` | `claude-sonnet-4-5` | `claude-sonnet-4-5` |
| OpenAI | `gpt-5-2` | `gpt-5-2` | `gpt-4.1-nano` |
| Google | `gemini-2.5-flash` | `gemini-2.5-flash-lite` | `gemini-2.5-flash-lite` |

---

## 6. UI cấu hình mô hình

| Component | File | Vai trò |
|-----------|------|---------|
| `ModelConfiguration` | [agents-manage-ui/src/components/shared/model-configuration.tsx](../agents-manage-ui/src/components/shared/model-configuration.tsx) | Widget chung: chọn provider, model, providerOptions, hiển thị inherited values |
| `ProjectModelsSection` | [agents-manage-ui/src/components/projects/form/project-models-section.tsx](../agents-manage-ui/src/components/projects/form/project-models-section.tsx) | Section trong form Project với 3 slot |
| `model-options.tsx` | [agents-manage-ui/src/components/agent/configuration/model-options.tsx](../agents-manage-ui/src/components/agent/configuration/model-options.tsx) | Danh sách model theo provider, default presets |
| `ProviderCredentialsManager` | [agents-manage-ui/src/components/provider-credentials/](../agents-manage-ui/src/components/provider-credentials/) | CRUD UI cho credentials |

UI hiển thị visual indicator khi giá trị đến từ inherit (cha) thay vì được set explicit ở cấp hiện tại.

---

## 7. Thêm một mô hình / provider mới vào hệ thống

Phần này hướng dẫn từng bước thêm một provider mới. Ví dụ minh hoạ: thêm **xAI** (Grok).

### Bước 1 — Thêm model constants

[packages/agents-core/src/constants/models.ts](../packages/agents-core/src/constants/models.ts):

```typescript
export const XAI_MODELS = {
  GROK_3: 'xai/grok-3',
  GROK_2: 'xai/grok-2',
} as const;

export type XaiModel = (typeof XAI_MODELS)[keyof typeof XAI_MODELS];
export type ModelName = AnthropicModel | OpenAIModel | GoogleModel | XaiModel;
```

Nếu muốn cho Gateway route được, thêm vào `GATEWAY_ROUTABLE_PROVIDERS_SET`.

### Bước 2 — Đăng ký provider trong `ModelFactory`

[packages/agents-core/src/utils/model-factory.ts](../packages/agents-core/src/utils/model-factory.ts):

```typescript
// 1. Thêm vào danh sách built-in providers
private static readonly BUILT_IN_PROVIDERS = [
  'anthropic', 'azure', 'openai', 'google', 'openrouter',
  'gateway', 'nim', 'custom', 'xai',  // ← thêm
  'mock',
] as const;

// 2. Thêm case trong createProvider()
case 'xai': {
  return createXai(config);
}

// 3. Thêm case trong createModel()
case 'xai':
  model = xai(modelName);
  break;
```

Import từ `@ai-sdk/xai`:

```typescript
import { createXai, xai } from '@ai-sdk/xai';
```

### Bước 3 — Thêm dependency

```bash
pnpm add @ai-sdk/xai --filter @inkeep/agents-core
```

(Sau đó chạy `pnpm install:all` để regenerate cả 3 lockfile theo quy ước trong [AGENTS.md](../AGENTS.md).)

### Bước 4 — Hỗ trợ credentials (nếu cần lưu API key)

[packages/agents-core/src/validation/schemas.ts](../packages/agents-core/src/validation/schemas.ts):

```typescript
export const ProviderCredentialProviders = [
  'anthropic', 'openai', 'google', 'openrouter', 'custom', 'xai',
] as const;
```

[packages/agents-core/src/utils/model-credentials-resolver.ts](../packages/agents-core/src/utils/model-credentials-resolver.ts):

```typescript
const PROVIDERS_WITH_DB_CREDENTIALS = new Set([
  'anthropic', 'openai', 'google', 'openrouter', 'custom', 'xai',
]);

// Fallback env var
if (process.env.XAI_API_KEY) result.add('xai');
```

### Bước 5 — Cập nhật UI

[agents-manage-ui/src/components/agent/configuration/model-options.tsx](../agents-manage-ui/src/components/agent/configuration/model-options.tsx):

```typescript
export const DEFAULT_XAI_BASE_MODEL = XAI_MODELS.GROK_3;
export const DEFAULT_XAI_STRUCTURED_OUTPUT_MODEL = XAI_MODELS.GROK_3;
export const DEFAULT_XAI_SUMMARIZER_MODEL = XAI_MODELS.GROK_2;

// Thêm vào MODEL_OPTIONS_BY_PROVIDER
xai: [
  { value: XAI_MODELS.GROK_3, label: 'Grok 3' },
  { value: XAI_MODELS.GROK_2, label: 'Grok 2' },
],
```

[agents-manage-ui/src/components/shared/model-configuration.tsx](../agents-manage-ui/src/components/shared/model-configuration.tsx):

```typescript
const AVAILABLE_PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'xai', label: 'xAI' },
] as const;
```

### Bước 6 — (Tuỳ chọn) Template `providerOptions`

Nếu provider có options đặc thù, thêm template trong `agents-manage-ui/src/lib/templates/model-templates.ts`:

```typescript
export const xaiModelProviderOptionsTemplate = `{
  "temperature": 0.7,
  "maxOutputTokens": 2048,
  "topP": 0.9
}`;
```

### Bước 7 — Test

Bắt buộc theo quy định trong `AGENTS.md`:

1. **Unit test** cho `ModelFactory.createModel()` với provider mới.
2. **Integration test** end-to-end gọi generate qua sub-agent dùng provider mới.
3. Nếu thêm credential support, test:
   - Create / update / test / delete credential.
   - Inject credential vào model lúc runtime.
   - Precedence: DB > env var.

### Bước 8 — Documentation & Changeset

1. Update `agents-docs/content/docs/` với MDX mô tả provider mới.
2. Tạo changeset:
   ```bash
   pnpm bump minor --pkg agents-core "Add xAI provider support"
   pnpm bump minor --pkg agents-manage-ui "Add xAI provider UI"
   ```

### Bước 9 — Verify

```bash
pnpm format
pnpm check
```

---

## 8. Checklist khi thêm provider mới

- [ ] Thêm constants ở `models.ts`
- [ ] Thêm vào `BUILT_IN_PROVIDERS` và 2 switch case trong `ModelFactory`
- [ ] Cài dependency `@ai-sdk/<provider>` + chạy `pnpm install:all`
- [ ] Cập nhật `ProviderCredentialProviders` (nếu cần lưu key)
- [ ] Cập nhật `PROVIDERS_WITH_DB_CREDENTIALS` + env var fallback
- [ ] Thêm default models + options vào UI (`model-options.tsx`)
- [ ] Thêm provider vào dropdown UI (`model-configuration.tsx`)
- [ ] Unit test + integration test
- [ ] Documentation (`agents-docs/`)
- [ ] Changeset (`pnpm bump`)
- [ ] `pnpm check` pass

---

## 9. Tham chiếu nhanh — File quan trọng

| Chức năng | File |
|-----------|------|
| Model constants | `packages/agents-core/src/constants/models.ts` |
| Zod schemas | `packages/agents-core/src/validation/schemas.ts` |
| `ModelFactory` | `packages/agents-core/src/utils/model-factory.ts` |
| Credential resolver | `packages/agents-core/src/utils/model-credentials-resolver.ts` |
| Secret encryption | `packages/agents-core/src/utils/secret-encryption.ts` |
| Credential DAL | `packages/agents-core/src/data-access/manage/providerCredentials.ts` |
| DB schema | `packages/agents-core/src/db/manage/manage-schema.ts` |
| Runtime resolver | `agents-api/src/domains/run/utils/model-resolver.ts` |
| Generation config | `agents-api/src/domains/run/agents/generation/model-config.ts` |
| API routes | `agents-api/src/domains/manage/routes/providerCredentials.ts` |
| UI — model config widget | `agents-manage-ui/src/components/shared/model-configuration.tsx` |
| UI — project models | `agents-manage-ui/src/components/projects/form/project-models-section.tsx` |
| UI — model options | `agents-manage-ui/src/components/agent/configuration/model-options.tsx` |
| UI — credentials | `agents-manage-ui/src/components/provider-credentials/` |

---

## 10. Credential-driven model picker & runtime injection

Hai cơ chế bổ sung làm trải nghiệm cấu hình model an toàn hơn và loại bỏ class lỗi `Custom provider requires baseURL ...` (xem [TROUBLESHOT.md §4](../TROUBLESHOT.md)).

### 10.1. Model picker chỉ hiển thị mô hình project có credential

Dropdown chọn model ở UI sẽ chỉ liệt kê mô hình từ các provider mà project đã setup credential.

- Backend: `GET /tenants/{t}/projects/{p}/provider-credentials/available-models` trả về:
  ```json
  {
    "data": [
      {
        "provider": "openai",
        "models": [{ "id": "openai/gpt-5.1", "label": "openai/gpt-5.1" }, ...]
      },
      {
        "provider": "custom",
        "models": [{ "id": "custom/openai/gpt-5.1", "label": "openai/gpt-5.1" }, ...]
      }
    ]
  }
  ```
- Logic per-provider, định nghĩa ở [discoverModelsForProvider](../packages/agents-core/src/utils/provider-model-discovery.ts):
  | Provider | Nguồn |
  |----------|-------|
  | `anthropic`, `google` | Curated list cứng từ `constants/models.ts` |
  | `openai` | Curated list + probe `{baseUrl ?? https://api.openai.com/v1}/models`; merge unique |
  | `openrouter` | Probe `{baseUrl ?? https://openrouter.ai/api/v1}/models`, prefix `openrouter/` |
  | `custom` | **Bắt buộc** probe `{baseUrl}/models`, prefix `custom/`. Không có fallback curated. |
- Cache: in-process Map TTL 5 phút, key `provider+baseUrl+sha256(apiKey).slice(0,16)`. Reset khi process restart hoặc gọi `_clearProviderModelCacheForTests()`.
- Frontend: hook `useAvailableModelsQuery()` ở [agents-manage-ui/src/lib/query/provider-credentials.ts](../agents-manage-ui/src/lib/query/provider-credentials.ts), staleTime 5 phút. `ModelSelector` merge danh sách động vào group "Custom OpenAI-compatible" và "LLM Gateway → OpenRouter". User vẫn có thể nhập tay model ID nếu probe trả về rỗng.
- Filter provider: vẫn dựa vào `/enabled-providers` (đã có sẵn) — nếu OpenAI không có credential thì các model OpenAI curated sẽ bị ẩn khỏi dropdown.

### 10.2. Credential là single source of truth cho `baseURL`

Trước đây, nếu một sub-agent `models` override quên `providerOptions.baseURL` (thường xảy ra khi edit qua Visual Builder), runtime throw `Custom provider requires configuration. Please provide baseURL in providerOptions.baseURL`. Cấu hình rời rạc giữa nhiều nơi → dễ stale.

[resolveModelSettingsWithDbCredentials](../packages/agents-core/src/utils/model-credentials-resolver.ts) bây giờ inject baseURL từ `provider_credentials.baseUrl` của provider tương ứng, **override** mọi giá trị có sẵn trong `providerOptions`:

```
ModelSettings từ DB (project / agent / sub-agent)
       │
       ▼
resolveModelSettingsWithDbCredentials()
       │  - Nếu provider ∈ {custom, openrouter} VÀ credential.baseUrl tồn tại:
       │    → merged.baseURL = credential.baseUrl   (luôn thắng)
       │    → delete merged.baseUrl                  (chuẩn hoá key)
       │  - apiKey: explicit > credential > env
       │
       ▼
ModelFactory.createModel(merged)
```

Quy tắc cụ thể:

| Trường | Behavior |
|--------|----------|
| `apiKey` | Explicit ở `providerOptions` > DB credential > env var. Cho phép transient apiKey injection ad-hoc. |
| `baseURL` (custom, openrouter) | DB credential **thắng** nếu set. Project/sub-agent config chỉ là default cho dev local không có credential. |
| `baseURL` (anthropic, openai, google) | Không thay đổi — không inject từ credential vì các provider này có endpoint cố định. |

Lợi ích:
- Project config `model: "custom/openai/gpt-5.1"` **không cần** kèm `providerOptions.baseURL`.
- Sub-agent override thiếu `providerOptions` không còn break runtime.
- Đổi `baseUrl` ở credential → toàn project nhận giá trị mới, không phải `inkeep push` lại.
- TROUBLESHOT.md §4 trở thành non-issue (vẫn giữ trong doc làm reference cho code path cũ).

### 10.3. Khi nào cache invalidate

Cache 5 phút của `discoverModelsForProvider` **không** invalidate tự động khi:
- Update credential apiKey → fingerprint đổi → cache key đổi → auto-fresh ngay.
- Update credential baseUrl → cache key đổi → auto-fresh ngay.
- Delete credential → row mất → endpoint không liệt kê provider đó nữa, nhưng cache entry cũ vẫn nằm (an toàn vì không ai gọi tới).
- Provider phía remote (OpenRouter, custom) thêm model mới → user phải đợi tối đa 5 phút hoặc restart agents-api.

Nếu cần force refresh: restart agents-api. Không expose endpoint clear cache để tránh bị abuse.

## 11. Các "gotcha" thường gặp

- **Format model string sai**: phải đúng `"provider/model-id"`, không có space, không có version prefix khác.
- **Azure thiếu config**: phải có `resourceName` HOẶC `baseURL` trong `providerOptions`, nếu không `createAzure()` sẽ throw.
- **Encryption key chưa set**: `INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY` phải là 32 bytes (hex/base64) — set sai sẽ break toàn bộ credential flow.
- **Quên thêm vào `BUILT_IN_PROVIDERS`**: `parseModelString` sẽ reject provider không có trong list.
- **Inheritance "ngầm"**: nếu set `structuredOutput` ở agent nhưng để trống `base`, runtime vẫn fallback về project `base` — đây là behavior mong muốn, không phải bug.
- **Env var vs DB credential**: nếu cả 2 đều có, **DB credential thắng**. Để debug, dùng `getUsableProviders()` xem provider nào đang active.
