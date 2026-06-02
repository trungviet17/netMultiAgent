# Đóng gói & triển khai bằng Docker

Hướng dẫn build toàn bộ Inkeep Agent Platform từ source của repo này thành các image Docker, đẩy lên Docker Hub, và triển khai ở bất kỳ máy nào chỉ với Docker + Docker Compose.

> Bạn **không cần** clone repo trên máy deploy. Chỉ cần build & push một lần (ở máy có source), rồi copy `docker-compose.deploy.yml` + `.env.docker` sang máy đích.

---

## 1. Kiến trúc đóng gói

Hệ thống gồm **3 image ứng dụng** (build từ source) + **các datastore** dùng image chính thức:

| Image | Build target | Cổng | Vai trò |
|---|---|---|---|
| `${DOCKERHUB_NAMESPACE}/agents-api` | `api` | 3002 | API hợp nhất (manage + run + evals) |
| `${DOCKERHUB_NAMESPACE}/agents-manage-ui` | `manage-ui` | 3000 | Dashboard Next.js (standalone) |
| `${DOCKERHUB_NAMESPACE}/agents-migrate` | `migrate` | — | Chạy 1 lần: migrate DB + ghi SpiceDB schema + tạo admin, rồi thoát |

| Datastore (image chính thức) | Vai trò |
|---|---|
| `dolthub/doltgresql` | Manage DB (cấu hình agent/project/tool — versioned) |
| `postgres:18` | Runtime DB (conversations, tasks, auth…) |
| `authzed/spicedb` + `postgres:16` | Phân quyền (authorization) |

**File liên quan:**

| File | Mục đích |
|---|---|
| [Dockerfile](Dockerfile) | Multi-stage, 3 target (`api` / `manage-ui` / `migrate`) dùng chung stage build |
| [.dockerignore](.dockerignore) | Thu nhỏ build context |
| [docker-compose.build.yml](docker-compose.build.yml) | Build + push 3 image lên registry |
| [docker-compose.deploy.yml](docker-compose.deploy.yml) | Triển khai tự chứa (app + 3 datastore) |
| [.env.docker.example](.env.docker.example) | Mẫu biến môi trường |

Cả ba image dùng **chung** stage `builder` trong Dockerfile, nên một lần `docker compose build` chỉ cài đặt + build monorepo **một lần** rồi tái sử dụng cho cả ba.

---

## 2. Yêu cầu

- Docker Engine 24+ và Docker Compose v2 (`docker compose`, không phải `docker-compose`).
- Một tài khoản **Docker Hub** (hoặc registry khác: GHCR, ECR…).
- **RAM cho Docker ≥ 6–8 GB** khi build (bước `next build` của Manage UI khá nặng). Trên macOS: Docker Desktop → Settings → Resources → Memory.
- `openssl` để sinh secret.

---

## 3. Cấu hình biến môi trường

Tạo file `.env.docker` từ mẫu (file này đã được `.gitignore`, an toàn để chứa secret):

```bash
cp .env.docker.example .env.docker
```

### 3.1. Chọn namespace & tag image

Trong `.env.docker`:

```dotenv
DOCKERHUB_NAMESPACE=your-dockerhub-user   # username/org Docker Hub của bạn
IMAGE_TAG=0.73.5                          # nên dùng version, tránh để "latest" cho production
```

> Hai biến này quyết định tên image: `your-dockerhub-user/agents-api:0.73.5`, … Build và deploy **phải dùng cùng giá trị**.

### 3.2. Sinh secret bắt buộc

```bash
# 4 secret ngẫu nhiên
echo "INKEEP_AGENTS_RUN_API_BYPASS_SECRET=$(openssl rand -base64 32)"
echo "INKEEP_AGENTS_JWT_SIGNING_SECRET=$(openssl rand -base64 32)"
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
echo "SPICEDB_PRESHARED_KEY=$(openssl rand -base64 32)"

# Cặp khóa RSA cho JWT playground (in ra 2 dòng INKEEP_AGENTS_TEMP_JWT_*)
bash scripts/generate-jwt-keys.sh playground
```

Dán kết quả vào `.env.docker`. Ngoài ra cần đặt:

```dotenv
# Ít nhất MỘT provider AI
ANTHROPIC_API_KEY=sk-ant-...

# Tài khoản admin khởi tạo (migrate sẽ tạo user này)
INKEEP_AGENTS_MANAGE_UI_USERNAME=admin@example.com
INKEEP_AGENTS_MANAGE_UI_PASSWORD=<mật-khẩu-mạnh>
```

### 3.3. URL công khai (QUAN TRỌNG cho Manage UI)

Trình duyệt gọi thẳng tới Agents API, nên `PUBLIC_INKEEP_AGENTS_API_URL` phải là địa chỉ **trình duyệt truy cập được** (IP/domain của máy deploy, không phải `localhost` nếu deploy trên server từ xa):

```dotenv
# Ví dụ deploy trên VM có IP 203.0.113.10
PUBLIC_INKEEP_AGENTS_API_URL=http://203.0.113.10:3002
INKEEP_AGENTS_API_URL=http://203.0.113.10:3002
INKEEP_AGENTS_MANAGE_UI_URL=http://203.0.113.10:3000
```

> Nango / SigNoz là **tùy chọn** — nếu chưa chạy thì giữ giá trị mặc định, các tính năng credentials/observability tương ứng sẽ tạm thời không hoạt động nhưng app vẫn chạy.

---

## 4. Build image

```bash
# Nạp biến từ .env.docker vào shell (để compose thay thế ${DOCKERHUB_NAMESPACE}, ${IMAGE_TAG})
set -a && source .env.docker && set +a

docker compose -f docker-compose.build.yml build
```

Kết quả: 3 image local — `…/agents-api:<tag>`, `…/agents-manage-ui:<tag>`, `…/agents-migrate:<tag>`.

Kiểm tra:

```bash
docker images | grep "$DOCKERHUB_NAMESPACE"
```

---

## 5. Đẩy (push) lên Docker Hub

```bash
docker login                                   # nhập username/password hoặc access token
docker compose -f docker-compose.build.yml push
```

Sau khi push, 3 image có mặt trên Docker Hub dưới namespace của bạn và có thể pull ở bất kỳ đâu.

### 5.1. Image đa kiến trúc (amd64 + arm64) — khuyến nghị

Nếu bạn build trên máy Apple Silicon (arm64) nhưng deploy lên server Intel/AMD (amd64), hãy build đa kiến trúc bằng `buildx` (bake đọc trực tiếp file compose build và vẫn dùng chung stage):

```bash
# Tạo builder hỗ trợ multi-arch (chỉ làm 1 lần)
docker buildx create --name multiarch --driver docker-container --use
docker login

set -a && source .env.docker && set +a

docker buildx bake -f docker-compose.build.yml \
  --set "*.platform=linux/amd64,linux/arm64" \
  --push
```

> Với multi-arch, image được build và push thẳng lên registry (không lưu local). Bỏ `--push` và thêm `--set "*.output=type=docker"` nếu chỉ muốn build 1 kiến trúc để test cục bộ.

---

## 6. Triển khai ở máy bất kỳ

Trên máy đích chỉ cần **2 file**: `docker-compose.deploy.yml` và `.env.docker`.

```bash
# Copy 2 file sang server, rồi:
docker login    # nếu image ở namespace/registry private
set -a && source .env.docker && set +a

docker compose -f docker-compose.deploy.yml --env-file .env.docker up -d
```

Thứ tự khởi động được Compose điều phối tự động qua `depends_on` + healthcheck:

1. Các DB (Doltgres, Postgres, SpiceDB + Postgres của nó) khởi động và chờ healthy.
2. `inkeep-agents-migrate` chạy migrate + ghi SpiceDB schema + tạo admin **rồi thoát** (`exit 0`).
3. `inkeep-agents-api` khởi động sau khi migrate hoàn tất.
4. `inkeep-agents-manage-ui` khởi động sau API.

Theo dõi tiến trình:

```bash
docker compose -f docker-compose.deploy.yml logs -f inkeep-agents-migrate
docker compose -f docker-compose.deploy.yml ps
```

### 6.1. Truy cập & đăng nhập lần đầu

- Dashboard: `http://<host>:3000`
- API / OpenAPI: `http://<host>:3002`
- Đăng nhập bằng `INKEEP_AGENTS_MANAGE_UI_USERNAME` / `INKEEP_AGENTS_MANAGE_UI_PASSWORD` đã đặt ở mục 3.2.

### 6.2. Đổi cổng (port) host

Các cổng host đều đọc từ `.env` / `.env.docker`, mặc định giữ nguyên giá trị cũ nên không cần đặt gì nếu bạn dùng cổng tiêu chuẩn. Khi cần tránh xung đột cổng, đặt các biến sau (và cập nhật `*_URL` tương ứng):

```dotenv
# docker-compose.deploy.yml (và docker-compose.yml)
AGENTS_API_PORT=3002        # cổng host của Agents API
MANAGE_UI_PORT=3000         # cổng host của Manage UI
```

Với stack DB cục bộ (`docker-compose.dbs.yml`) còn có:

```dotenv
DOLTGRES_PORT=5432          # phải khớp port trong INKEEP_AGENTS_MANAGE_DATABASE_URL
POSTGRES_PORT=5433          # phải khớp port trong INKEEP_AGENTS_RUN_DATABASE_URL
SPICEDB_GRPC_PORT=50051     # phải khớp port trong SPICEDB_ENDPOINT
SPICEDB_HTTP_PORT=8443
SPICEDB_POSTGRES_PORT=5434
MAILPIT_UI_PORT=8025
SMTP_PORT=1025              # đồng thời là cổng SMTP host của mailpit
```

> Lưu ý: cổng host của DB phải khớp với cổng nhúng trong connection URL / endpoint, vì Docker Compose không tự phân tích URL được.

---

## 7. Vận hành

```bash
# Xem log một service
docker compose -f docker-compose.deploy.yml logs -f inkeep-agents-api

# Cập nhật lên tag mới (sau khi đã build & push tag đó)
export IMAGE_TAG=0.73.6
docker compose -f docker-compose.deploy.yml --env-file .env.docker pull
docker compose -f docker-compose.deploy.yml --env-file .env.docker up -d

# Chạy lại migrate thủ công (idempotent — an toàn khi lặp lại)
docker compose -f docker-compose.deploy.yml --env-file .env.docker up inkeep-agents-migrate

# Dừng (giữ dữ liệu trong volume)
docker compose -f docker-compose.deploy.yml down

# Xóa SẠCH cả dữ liệu (cẩn thận: mất toàn bộ DB)
docker compose -f docker-compose.deploy.yml down -v
```

### 7.1. Sao lưu dữ liệu

Dữ liệu nằm trong các named volume: `inkeep-agents-doltgres-data`, `inkeep-agents-postgres-data`, `inkeep-agents-spicedb-postgres-data`. Backup ví dụ:

```bash
docker run --rm -v inkeep-agents-postgres-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/postgres-data.tgz -C /data .
```

---

## 8. Dùng database ngoài (tùy chọn, cho production)

Nếu bạn muốn dùng Postgres/Doltgres/SpiceDB managed (RDS, Neon, Authzed Cloud…) thay vì container:

1. Bỏ các service DB khỏi `docker-compose.deploy.yml` (hoặc tạo bản rút gọn chỉ còn `api` + `manage-ui` + `migrate`).
2. Trỏ các biến tới hạ tầng của bạn:

```dotenv
INKEEP_AGENTS_MANAGE_DATABASE_URL=postgresql://user:pass@your-doltgres-host:5432/inkeep_agents
INKEEP_AGENTS_RUN_DATABASE_URL=postgresql://user:pass@your-postgres-host:5432/inkeep_agents
SPICEDB_ENDPOINT=your-spicedb-host:50051
SPICEDB_PRESHARED_KEY=...
SPICEDB_TLS_ENABLED=true
```

3. Bỏ các `depends_on` trỏ tới service DB đã xóa.

---

## 9. Xử lý sự cố

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| Build báo `Set DOCKERHUB_NAMESPACE` | Chưa nạp biến: chạy `set -a && source .env.docker && set +a` trước lệnh compose. |
| `next build` bị OOM/killed | Tăng RAM cho Docker (≥ 6–8 GB). Stage builder đã đặt `--max-old-space-size=4096`. |
| Manage UI tải được nhưng gọi API lỗi (CORS/connection refused) | `PUBLIC_INKEEP_AGENTS_API_URL` đang là `localhost` trong khi truy cập từ máy khác — đặt thành IP/domain thật của server. |
| `exec format error` khi chạy trên server | Image build cho sai kiến trúc — build đa kiến trúc (mục 5.1) hoặc build ngay trên server đích. |
| Migrate fail ở SpiceDB | Kiểm tra `inkeep-agents-spicedb` đã healthy và `SPICEDB_PRESHARED_KEY` khớp giữa migrate, api và service spicedb. |
| Container API restart liên tục | Xem `logs inkeep-agents-api`; thường do thiếu secret bắt buộc hoặc DB chưa migrate. |

> **Ghi chú về kích thước image:** image `api` và `migrate` mang theo toàn bộ workspace đã cài (để pnpm resolve workspace dependency và để `migrate` chạy `tsx`/`drizzle-kit`), nên khá lớn. Đây là đánh đổi để đảm bảo chạy đúng. Có thể tối ưu sau bằng `pnpm deploy --prod` hoặc tách store, nhưng không bắt buộc để hệ thống hoạt động.
