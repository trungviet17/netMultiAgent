#!/usr/bin/env bash
#
# Triển khai Inkeep Agent Platform trên server Linux từ image đã push lên Docker Hub.
#
# Chỉ cần 3 file trên server:  docker-compose.deploy.yml  +  .env.docker  +  deploy-server.sh
#
# Dùng:
#   ./deploy-server.sh                 # deploy với .env.docker hiện có
#   ./deploy-server.sh 203.0.113.10    # tự thay YOUR_SERVER_IP -> 203.0.113.10 trong .env.docker rồi deploy
#
set -euo pipefail

COMPOSE_FILE="docker-compose.deploy.yml"
ENV_FILE=".env.docker"
SERVER_HOST="${1:-}"

cd "$(dirname "$0")"

# --- Kiểm tra điều kiện ----------------------------------------------------
command -v docker >/dev/null 2>&1 || { echo "❌ Chưa cài docker."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ Cần Docker Compose v2 (lệnh 'docker compose')."; exit 1; }
[ -f "$COMPOSE_FILE" ] || { echo "❌ Thiếu $COMPOSE_FILE (copy từ repo sang)."; exit 1; }
[ -f "$ENV_FILE" ]     || { echo "❌ Thiếu $ENV_FILE (copy từ repo sang)."; exit 1; }

# --- (Tùy chọn) thay IP/domain server vào URL công khai --------------------
if [ -n "$SERVER_HOST" ]; then
  echo "🔧 Đặt YOUR_SERVER_IP -> $SERVER_HOST trong $ENV_FILE"
  sed -i.bak "s|YOUR_SERVER_IP|$SERVER_HOST|g" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
fi

# --- Cảnh báo placeholder chưa điền ---------------------------------------
problems=0
if grep -q "YOUR_SERVER_IP" "$ENV_FILE"; then
  echo "⚠️  Còn 'YOUR_SERVER_IP' trong $ENV_FILE — sửa thủ công hoặc chạy: ./deploy-server.sh <ip>"; problems=1
fi
if ! grep -qE "^(ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|AZURE_API_KEY)=.+" "$ENV_FILE"; then
  echo "⚠️  Chưa đặt provider AI nào (ANTHROPIC_API_KEY=...) trong $ENV_FILE."; problems=1
fi
if ! grep -qE "^INKEEP_AGENTS_MANAGE_UI_PASSWORD=.+" "$ENV_FILE"; then
  echo "⚠️  Chưa đặt INKEEP_AGENTS_MANAGE_UI_PASSWORD (mật khẩu admin) trong $ENV_FILE."; problems=1
fi
if [ "$problems" -ne 0 ]; then
  echo ""
  read -r -p "Vẫn tiếp tục deploy? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Dừng."; exit 1; }
fi

# --- Kéo image & khởi chạy -------------------------------------------------
echo "📥 Pull image từ Docker Hub..."
echo "   (Nếu repo trên Docker Hub là PRIVATE: chạy 'docker login' trước.)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull

echo "🚀 Khởi chạy stack (migrate chạy 1 lần, API đợi migrate xong)..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

echo ""
echo "📋 Log migrate (Ctrl-C để thoát khi thấy 'completed successfully'):"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs -f inkeep-agents-migrate || true

echo ""
echo "✅ Xong. Trạng thái:"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

# In URL truy cập dựa trên .env.docker
ui_url=$(grep -E "^INKEEP_AGENTS_MANAGE_UI_URL=" "$ENV_FILE" | cut -d= -f2-)
api_url=$(grep -E "^INKEEP_AGENTS_API_URL=" "$ENV_FILE" | cut -d= -f2-)
echo ""
echo "🌐 Manage UI : ${ui_url:-http://<server>:3000}"
echo "🌐 Agents API: ${api_url:-http://<server>:3002}"
echo "👤 Đăng nhập bằng INKEEP_AGENTS_MANAGE_UI_USERNAME / _PASSWORD trong $ENV_FILE"
