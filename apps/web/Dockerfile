# Imagen de PRODUCCIÓN de la web (estáticos + proxy /api con nginx). Construir desde la raíz:
#   docker build -f apps/web/Dockerfile -t viaticos-web .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
ENV CI=true

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm --filter @viaticos/web build

FROM nginx:1.29-alpine AS runtime
ENV API_UPSTREAM=http://api:3000
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
