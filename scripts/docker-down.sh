#!/usr/bin/env bash
set -euo pipefail

# docker-down.sh — Stop or tear down the local Docker dev stack.
#
# Counterpart to `pnpm setup-dev` (which brings up docker-compose.dbs.yml).
# Ports are read from .env by Docker Compose, same as on the way up.
#
# Usage:
#   ./scripts/docker-down.sh                 Stop + remove containers & networks (keeps volumes/data)
#   ./scripts/docker-down.sh stop            Stop containers only (fast restart, nothing removed)
#   ./scripts/docker-down.sh down            Same as the default
#   ./scripts/docker-down.sh down -v         Also DELETE volumes (wipes all DB data) — prompts to confirm
#
# Options:
#   -v, --volumes        Remove named volumes too (DESTRUCTIVE: deletes all DB data)
#   -f, --file FILE      Compose file to target (default: docker-compose.dbs.yml)
#       --full           Shortcut for the full app stack (docker-compose.yml)
#       --remove-orphans Remove containers for services not in the compose file
#   -y, --yes            Skip the confirmation prompt when removing volumes
#   -h, --help           Show this help
#
# Note: for isolated parallel environments use ./scripts/isolated-env.sh down <name>.

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

COMMAND="down"
COMPOSE_FILE="$REPO_ROOT/docker-compose.dbs.yml"
REMOVE_VOLUMES=0
REMOVE_ORPHANS=0
ASSUME_YES=0

usage() {
  # Print the leading comment block (lines after the shebang/set) as help text.
  awk 'NR<4 {next} /^#/ {sub(/^#( )?/, ""); print; next} {exit}' "$0"
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    down | stop)
      COMMAND="$1"
      ;;
    -v | --volumes)
      REMOVE_VOLUMES=1
      ;;
    --remove-orphans)
      REMOVE_ORPHANS=1
      ;;
    --full)
      COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"
      ;;
    -f | --file)
      shift
      [ $# -gt 0 ] || { printf '%b\n' "${RED}Error: --file requires a path${NC}" >&2; exit 1; }
      case "$1" in
        /*) COMPOSE_FILE="$1" ;;
        *) COMPOSE_FILE="$REPO_ROOT/$1" ;;
      esac
      ;;
    -y | --yes)
      ASSUME_YES=1
      ;;
    -h | --help)
      usage 0
      ;;
    *)
      printf '%b\n' "${RED}Error: unknown argument '$1'${NC}" >&2
      usage 1
      ;;
  esac
  shift
done

if [ ! -f "$COMPOSE_FILE" ]; then
  printf '%b\n' "${RED}Error: compose file not found: $COMPOSE_FILE${NC}" >&2
  exit 1
fi

if [ "$COMMAND" = "stop" ] && [ "$REMOVE_VOLUMES" = "1" ]; then
  printf '%b\n' "${RED}Error: --volumes only applies to 'down' (volumes can't be removed while just stopping)${NC}" >&2
  exit 1
fi

# Resolve docker compose v2 vs legacy docker-compose.
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif docker-compose version >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  printf '%b\n' "${RED}Error: docker compose not found. Install Docker Desktop or docker-compose.${NC}" >&2
  exit 1
fi

# Run from the repo root so Compose loads .env and uses the same default project
# name that `pnpm setup-dev` used on the way up.
cd "$REPO_ROOT"

args=("-f" "$COMPOSE_FILE" "$COMMAND")

if [ "$COMMAND" = "down" ]; then
  [ "$REMOVE_ORPHANS" = "1" ] && args+=("--remove-orphans")
  if [ "$REMOVE_VOLUMES" = "1" ]; then
    if [ "$ASSUME_YES" != "1" ]; then
      printf '%b' "${YELLOW}This will DELETE all Docker volumes for $(basename "$COMPOSE_FILE") (databases, SpiceDB, mailpit). Data cannot be recovered.${NC}\n"
      printf 'Continue? [y/N] '
      read -r reply
      case "$reply" in
        y | Y | yes | YES) ;;
        *) echo "Aborted."; exit 0 ;;
      esac
    fi
    args+=("--volumes")
  fi
fi

printf '%b\n' "${GREEN}→ ${COMPOSE[*]} ${args[*]}${NC}"
"${COMPOSE[@]}" "${args[@]}"

if [ "$COMMAND" = "stop" ]; then
  printf '%b\n' "${GREEN}✓ Containers stopped. Restart with: ${COMPOSE[*]} -f $(basename "$COMPOSE_FILE") start${NC}"
elif [ "$REMOVE_VOLUMES" = "1" ]; then
  printf '%b\n' "${GREEN}✓ Containers, networks, and volumes removed. Run 'pnpm setup-dev' to recreate.${NC}"
else
  printf '%b\n' "${GREEN}✓ Containers and networks removed (volumes/data kept). Bring back up with: ${COMPOSE[*]} -f $(basename "$COMPOSE_FILE") up -d${NC}"
fi
