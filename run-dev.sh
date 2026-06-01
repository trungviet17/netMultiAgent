#!/usr/bin/env bash
#
# run-dev.sh — Khởi chạy toàn bộ stack dev của Inkeep Agent Framework.
#
# Thứ tự thực hiện (idempotent — chạy lại nhiều lần đều an toàn):
#   1. Kiểm tra công cụ cần thiết (docker, pnpm, node)
#   2. Dựng các DB container (Doltgres 5432, Postgres 5433, SpiceDB 50051/8443, ...)
#   3. Chờ DB sẵn sàng nhận kết nối
#   4. Cài dependencies (nếu thiếu node_modules)
#   5. Build @inkeep/agents-core (nếu thiếu dist)
#   6. Chạy migrations + tạo org/admin mặc định
#   7. Khởi chạy dev servers: API + Manage UI + Docs (foreground)
#
# Cách dùng:
#   ./run-dev.sh                  # chạy đầy đủ rồi `pnpm dev`
#   ./run-dev.sh --skip-install   # bỏ qua bước pnpm install
#   ./run-dev.sh --skip-db        # không đụng tới Docker DB (DB đã chạy sẵn)
#   ./run-dev.sh --skip-migrate   # bỏ qua migrate + auth init
#   ./run-dev.sh --db-only        # chỉ dựng DB + migrate, KHÔNG chạy dev servers
#   ./run-dev.sh -h | --help

set -euo pipefail

# --- Resolve repo root (thư mục chứa script này) ---------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$SCRIPT_DIR"

# --- Cấu hình ---------------------------------------------------------------
DB_COMPOSE_FILE="docker-compose.dbs.yml"
API_PORT="${AGENTS_API_PORT:-3002}"
UI_PORT="${MANAGE_UI_PORT:-3000}"
DOCS_PORT="3010"
DOLT_PORT="5432"
PG_PORT="5433"
DB_WAIT_TIMEOUT=90   # giây

# --- Flags ------------------------------------------------------------------
SKIP_INSTALL=0
SKIP_DB=0
SKIP_MIGRATE=0
DB_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-db)      SKIP_DB=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --db-only)      DB_ONLY=1 ;;
    -h|--help)
      awk 'NR==1{next} /^set /{exit} /^#/{sub(/^# ?/,""); print; next} /^$/{print}' "$0"
      exit 0
      ;;
    *)
      echo "Tham số không hợp lệ: $arg (dùng --help để xem hướng dẫn)" >&2
      exit 1
      ;;
  esac
done

# --- Logging helpers --------------------------------------------------------
if [ -t 1 ]; then
  C_BLUE="\033[1;34m"; C_GREEN="\033[1;32m"; C_YELLOW="\033[1;33m"; C_RED="\033[1;31m"; C_DIM="\033[2m"; C_OFF="\033[0m"
else
  C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_DIM=""; C_OFF=""
fi
step()  { echo -e "\n${C_BLUE}▶ $*${C_OFF}"; }
ok()    { echo -e "${C_GREEN}✓ $*${C_OFF}"; }
warn()  { echo -e "${C_YELLOW}⚠ $*${C_OFF}"; }
fail()  { echo -e "${C_RED}✗ $*${C_OFF}" >&2; }

# --- 1. Prerequisites -------------------------------------------------------
step "Kiểm tra công cụ cần thiết"
need() { command -v "$1" >/dev/null 2>&1 || { fail "Thiếu '$1'. Hãy cài đặt trước khi chạy."; exit 1; }; }
need node
need pnpm
if [ "$SKIP_DB" -eq 0 ]; then
  need docker
  if ! docker info >/dev/null 2>&1; then
    fail "Docker chưa chạy. Hãy mở Docker Desktop rồi thử lại (hoặc dùng --skip-db nếu DB đã chạy)."
    exit 1
  fi
fi
ok "node $(node -v), pnpm $(pnpm -v)"

if [ ! -f ".env" ]; then
  warn "Không tìm thấy .env ở repo root."
  warn "Lần đầu setup nên chạy: ${C_OFF}pnpm setup-dev${C_YELLOW} (tạo .env + DB + migrations + admin)."
  warn "Script vẫn tiếp tục, nhưng thiếu .env có thể khiến app không khởi động được."
fi

# --- 2 + 3. Databases -------------------------------------------------------
wait_for_port() {
  local host="127.0.0.1" port="$1" name="$2" elapsed=0
  printf "  chờ %s (:%s) " "$name" "$port"
  until (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; do
    exec 3>&- 2>/dev/null || true
    if [ "$elapsed" -ge "$DB_WAIT_TIMEOUT" ]; then
      echo ""; fail "Quá thời gian chờ $name (:$port) sau ${DB_WAIT_TIMEOUT}s."; exit 1
    fi
    printf "."; sleep 2; elapsed=$((elapsed + 2))
  done
  exec 3>&- 2>/dev/null || true
  echo " sẵn sàng"
}

if [ "$SKIP_DB" -eq 0 ]; then
  step "Khởi động database containers ($DB_COMPOSE_FILE)"
  docker compose -f "$DB_COMPOSE_FILE" up -d
  ok "Containers đã ở trạng thái up"

  step "Chờ database sẵn sàng"
  wait_for_port "$DOLT_PORT" "Doltgres (manage DB)"
  wait_for_port "$PG_PORT" "Postgres (run DB)"
else
  warn "Bỏ qua bước Docker DB (--skip-db). Giả định DB đã chạy."
fi

# --- 4. Dependencies --------------------------------------------------------
if [ "$SKIP_INSTALL" -eq 0 ]; then
  if [ ! -d "node_modules" ]; then
    step "Cài dependencies (pnpm install)"
    pnpm install
    ok "Đã cài dependencies"
  else
    step "Dependencies đã có (node_modules tồn tại) — bỏ qua install"
    echo -e "${C_DIM}  (dùng pnpm install thủ công nếu vừa đổi package.json)${C_OFF}"
  fi
else
  warn "Bỏ qua pnpm install (--skip-install)"
fi

# --- 5. Build agents-core (nếu thiếu dist) ----------------------------------
if [ ! -d "packages/agents-core/dist" ]; then
  step "Build @inkeep/agents-core (cần cho migrations/setup)"
  pnpm --filter @inkeep/agents-core build
  ok "Đã build agents-core"
fi

# --- 6. Migrations + admin --------------------------------------------------
if [ "$SKIP_MIGRATE" -eq 0 ]; then
  step "Áp dụng database migrations (manage + run)"
  if pnpm db:migrate; then
    ok "Migrations đã áp dụng (hoặc đã ở trạng thái mới nhất)"
  else
    warn "db:migrate báo lỗi — nếu DB đã migrate sẵn thì có thể bỏ qua. Kiểm tra log phía trên nếu app lỗi."
  fi

  step "Tạo organization + admin mặc định (idempotent)"
  if pnpm db:auth:init; then
    ok "Org/admin sẵn sàng"
  else
    warn "db:auth:init báo lỗi (thường do org/admin đã tồn tại) — tiếp tục."
  fi
else
  warn "Bỏ qua migrate + auth init (--skip-migrate)"
fi

# --- 7. Dev servers ---------------------------------------------------------
if [ "$DB_ONLY" -eq 1 ]; then
  step "Hoàn tất phần hạ tầng (--db-only). Không chạy dev servers."
  echo -e "  Chạy app khi sẵn sàng: ${C_GREEN}pnpm dev${C_OFF}"
  exit 0
fi

step "Khởi chạy dev servers (Ctrl+C để dừng)"
cat <<EOF
  ${C_GREEN}Manage UI${C_OFF}   →  http://localhost:${UI_PORT}
  ${C_GREEN}Agents API${C_OFF}  →  http://localhost:${API_PORT}   (OpenAPI: /openapi.json)
  ${C_GREEN}Docs${C_OFF}        →  http://localhost:${DOCS_PORT}
  ${C_DIM}Cấu hình LLM: mở Manage UI → mục "Model Providers" (cấp org) để thêm key trước khi tạo project.${C_OFF}
EOF

exec pnpm dev
