# syntax=docker/dockerfile:1
# Multi-stage build for the Capital Next.js app. Produces a small runtime image
# from Next's `output: 'standalone'` bundle. Build it on the target arch
# (e.g. arm64 on an Orange Pi) or with `docker buildx --platform`.

# ---- deps: install node_modules (cached unless the lockfile changes) ----------
FROM node:22-slim AS deps
WORKDIR /app
# Toolchain for any native module without an arm64 prebuild.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile the app ----------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# APP_ALLOWED_ORIGINS is baked into the server config (Server Actions CSRF check), so it
# must be a build arg. Everything else (DATABASE_URL, auth, SMTP) is read at runtime.
ARG APP_ALLOWED_ORIGINS
ENV APP_ALLOWED_ORIGINS=$APP_ALLOWED_ORIGINS

RUN npm run build

# ---- runner: minimal runtime image ---------------------------------------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=America/Sao_Paulo

RUN useradd --system --uid 1001 --create-home nextjs

# `standalone` does not include public/ or the static assets — copy them in.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
# SQL migrations, applied by the server when it starts (instrumentation.ts).
COPY --from=builder --chown=nextjs:nextjs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
