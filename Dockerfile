# Single image that builds BOTH the NestJS API and the Next.js web app.
# docker-compose.prod.yml runs it twice (api + web) via different commands.

# ---- Base: Debian slim + OpenSSL (Prisma) + toolchain (native deps: argon2) ----
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# ---- Build: install deps, generate Prisma client, build API + web ----
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/marketing/package.json apps/marketing/package.json
RUN npm ci
# App source
COPY . .
# Prisma client (schema in apps/api/prisma)
RUN npm run db:generate
# The browser bundle bakes this at build time — point it at your PUBLIC API URL.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Build each app in its own step so a failure STOPS here and its error is the last
# thing in the log (npm run --workspaces keeps going and hides which app broke).
RUN echo "== building api ==" && npm run build -w apps/api
RUN echo "== building marketing ==" && npm run build -w apps/marketing
RUN echo "== building web ==" && npm run build -w apps/web

# ---- Runtime ----
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
EXPOSE 3000 4000
# Overridden by compose per service (api runs migrations then boots; web serves).
# nest build nests the entry under dist/src (prisma/ is compiled too).
CMD ["node", "apps/api/dist/src/main.js"]
