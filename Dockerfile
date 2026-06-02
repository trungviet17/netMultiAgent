# syntax=docker/dockerfile:1.7
###############################################################################
# Inkeep Agent Platform — multi-stage, multi-target image build
#
# Builds three deployable images from this monorepo's source:
#   --target api        -> @inkeep/agents-api        (unified API, port 3002)
#   --target manage-ui  -> @inkeep/agents-manage-ui  (Next.js dashboard, port 3000)
#   --target migrate     -> one-shot DB migrate + SpiceDB schema + admin user, then exits
#
# The heavy `deps` and `builder` stages are shared. Within a single
# `docker compose build` (or `docker buildx bake`) invocation BuildKit
# computes them ONCE and reuses the result for all three images.
#
# See DOCKER.md for the full build / push / deploy guide.
###############################################################################

ARG NODE_IMAGE=node:22.18.0-slim
ARG PNPM_VERSION=10.33.0

# ---------------------------------------------------------------------------
# base — pnpm on the pinned Node runtime (shared by build + runtime stages)
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV CI=1 \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — warm the pnpm store from the lockfile.
# This layer is cached until pnpm-lock.yaml / pnpm-workspace.yaml change.
# ---------------------------------------------------------------------------
FROM base AS deps
# Toolchain for native addons that ship without a prebuilt binary for this arch
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm fetch

# ---------------------------------------------------------------------------
# builder — install the workspace and build the apps + their workspace deps.
# ---------------------------------------------------------------------------
FROM deps AS builder
# Skip multi-hundred-MB test-only browser downloads that the image never runs
ENV CYPRESS_INSTALL_BINARY=0 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    NODE_OPTIONS=--max-old-space-size=4096
COPY . .
RUN pnpm install --frozen-lockfile --prefer-offline
# Builds @inkeep/agents-api, @inkeep/agents-manage-ui and everything they
# depend on (agents-core, agents-email, agents-mcp, agents-work-apps).
RUN pnpm exec turbo build \
      --filter=@inkeep/agents-api \
      --filter=@inkeep/agents-manage-ui

# ---------------------------------------------------------------------------
# api — runtime for the unified Agents API
# ---------------------------------------------------------------------------
FROM base AS api
ENV NODE_ENV=production \
    PORT=3002
# The whole workspace is carried over so pnpm's symlinked workspace
# dependencies (@inkeep/agents-core, -email, -mcp, -work-apps) resolve at runtime.
COPY --from=builder /app /app
WORKDIR /app/agents-api
EXPOSE 3002
CMD ["node", "dist/index.js"]

# ---------------------------------------------------------------------------
# manage-ui — runtime for the Next.js dashboard (self-contained standalone output)
# ---------------------------------------------------------------------------
FROM base AS manage-ui
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# Next.js `output: 'standalone'` traces every server dependency it needs;
# `build:sync` has already folded public/ and .next/static into this tree.
COPY --from=builder /app/agents-manage-ui/.next/standalone ./
EXPOSE 3000
CMD ["node", "agents-manage-ui/server.js"]

# ---------------------------------------------------------------------------
# migrate — one-shot. Applies manage (Doltgres) + runtime (Postgres) migrations,
# writes the SpiceDB schema, and creates the initial admin user, then exits.
# Run before/alongside the API (compose handles ordering via depends_on).
# ---------------------------------------------------------------------------
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=builder /app /app
WORKDIR /app
CMD ["sh", "-c", "pnpm db:migrate && pnpm db:auth:init"]
