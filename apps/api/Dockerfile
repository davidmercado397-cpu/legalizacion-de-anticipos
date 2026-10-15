# Imagen de PRODUCCIÓN de la API. Construir desde la raíz del repositorio:
#   docker build -f apps/api/Dockerfile -t viaticos-api .
# Migraciones:  docker run --rm -e DATABASE_URL=... viaticos-api node dist/cli.js migrar
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
ENV CI=true

# Compila: el bundle de tsup incluye los paquetes del workspace (TypeScript fuente).
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm --filter @viaticos/api build

# Solo dependencias de producción de la API (sin herramientas de desarrollo ni paquetes web).
FROM base AS dependencias
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --prod --frozen-lockfile --filter "@viaticos/api..."

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencias --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencias --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./apps/api/drizzle
WORKDIR /app/apps/api
# Carpeta de soportes (montar un volumen aquí, o usar un almacén en la nube)
RUN mkdir -p /app/almacen && chown node:node /app/almacen
ENV ALMACEN_DIR=/app/almacen
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/v1/salud || exit 1
CMD ["node", "dist/main.js"]
