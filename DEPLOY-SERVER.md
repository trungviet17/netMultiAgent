# Triển khai lên server Linux (từ image Docker Hub `trungviet17`)

Hướng dẫn ngắn để chạy Inkeep Agent Platform trên một server Linux bất kỳ, dùng 3 image đã push:
`trungviet17/agents-api`, `trungviet17/agents-manage-ui`, `trungviet17/agents-migrate` (tag `0.73.5` / `latest`, kiến trúc **linux/amd64**).

> Đây là phần "chạy trên server". Phần build & push xem [DOCKER.md](DOCKER.md).

## 1. Yêu cầu trên server

- Linux **amd64** (image build cho amd64; không chạy trên ARM).
- Docker Engine 24+ và Docker Compose v2 (`docker compose`).
- Mở cổng `3000` (UI) và `3002` (API) tới nơi bạn truy cập.

## 2. Copy 3 file sang server

Từ máy này, copy sang server (ví dụ qua `scp`):

```bash
scp docker-compose.deploy.yml .env.docker deploy-server.sh user@SERVER:/opt/inkeep/
```

| File | Vai trò |
|---|---|
| `docker-compose.deploy.yml` | Định nghĩa 3 app + Doltgres + Postgres + SpiceDB |
| `.env.docker` | Cấu hình + secret (đã sinh sẵn; **gitignored**) |
| `deploy-server.sh` | Script deploy 1-lệnh |

> ⚠️ `.env.docker` chứa secret thật — copy qua kênh an toàn, không commit, không chia sẻ.

## 3. Sửa 3 giá trị trong `.env.docker`

1. **URL công khai** — thay `YOUR_SERVER_IP` bằng IP/domain server (địa chỉ **trình duyệt** truy cập được, không phải `localhost` nếu ở xa).
2. **`ANTHROPIC_API_KEY`** (hoặc một provider AI khác) — ít nhất một.
3. **`INKEEP_AGENTS_MANAGE_UI_PASSWORD`** — mật khẩu admin đăng nhập lần đầu (và đổi `INKEEP_AGENTS_MANAGE_UI_USERNAME` nếu muốn).

Các secret còn lại (`*_SECRET`, `SPICEDB_PRESHARED_KEY`, JWT keys) đã được sinh sẵn — giữ nguyên.

## 4. Deploy

```bash
cd /opt/inkeep
chmod +x deploy-server.sh

# Cách 1: truyền IP/domain, script tự thay YOUR_SERVER_IP rồi deploy
./deploy-server.sh 203.0.113.10

# Cách 2: đã tự sửa .env.docker rồi thì chạy không tham số
./deploy-server.sh
```

Script sẽ: `pull` image → `up -d` → đợi `inkeep-agents-migrate` chạy xong (migrate DB + schema SpiceDB + tạo admin) → in trạng thái và URL.

> Nếu repo Docker Hub để **private**: chạy `docker login` trên server trước khi deploy.

## 5. Truy cập

- Manage UI: `http://<server>:3000`
- Agents API: `http://<server>:3002`
- Đăng nhập bằng `INKEEP_AGENTS_MANAGE_UI_USERNAME` / `INKEEP_AGENTS_MANAGE_UI_PASSWORD`.

## 6. Vận hành

```bash
C="docker compose -f docker-compose.deploy.yml --env-file .env.docker"

$C logs -f inkeep-agents-api      # xem log API
$C ps                             # trạng thái service
$C pull && $C up -d               # cập nhật khi đổi IMAGE_TAG (build/push tag mới trước)
$C up inkeep-agents-migrate       # chạy lại migrate (idempotent)
$C down                           # dừng (giữ dữ liệu trong volume)
$C down -v                        # ⚠️ xóa SẠCH cả dữ liệu DB
```

## 7. Lưu ý

- **Kiến trúc**: image là amd64. Server ARM (Graviton…) sẽ không chạy — cần build lại multi-arch.
- **Nango / SigNoz** (credentials integrations & observability) là tùy chọn, mặc định tắt. Bỏ comment các biến tương ứng trong `.env.docker` nếu bạn chạy chúng riêng.
- **HTTPS / domain**: production nên đặt sau reverse proxy (Nginx/Caddy/Traefik) và dùng `https://domain` trong các biến `*_URL`.
- **Sao lưu**: dữ liệu nằm trong các Docker volume `inkeep-agents-*-data`. Sao lưu volume hoặc `pg_dump` định kỳ.
