# Imagen de DESARROLLO de la web (recarga en caliente con "docker compose up --watch").
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
ENV CI=true

# 1) Descarga de dependencias según el lockfile (capa en caché mientras el lockfile no cambie)
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

# 2) Código fuente + instalación sin red (incluye binarios nativos para Linux/musl, ej. argon2)
COPY . .
RUN pnpm install --offline --frozen-lockfile
