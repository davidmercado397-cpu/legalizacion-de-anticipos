# Viáticos: legalización de anticipos

Solicitud y aprobación de anticipos de viaje, captura de facturas por la app o por WhatsApp con lectura por IA, conciliación con el extracto bancario y legalización en Siesa.

- Reglas de negocio confirmadas (mandan sobre cualquier otra fuente): [docs/decisiones-confirmadas.md](docs/decisiones-confirmadas.md)
- Desarrollo local: [docs/desarrollo-local.md](docs/desarrollo-local.md)

## Estructura

```
apps/api/        API: Python 3.13 · FastAPI · SQLAlchemy 2 (async) · Alembic · Redis
                 WhatsApp Cloud API, OpenRouter (IA de visión), Cloudflare R2 (archivos)
                 Arquitectura hexagonal verificada con import-linter. Guía: apps/api/CLAUDE.md
apps/web/        Web: React 19 · TanStack Router/Query · Zustand · Axios · React Hook Form + Zod · Tailwind
packages/        Cliente HTTP y hooks de la web (reutilizables en una app móvil)
docker/          Imagen de desarrollo de la web y nginx de producción
```

El backend TypeScript que existía antes se reemplazó por `apps/api`; queda en el historial de git (commit `05c7bdb`).

## Inicio rápido (Docker)

```bash
git clone https://github.com/davidmercado397-cpu/legalizacion-de-anticipos.git
cd legalizacion-de-anticipos
cp .env.example .env
docker compose up --build --watch
```

Abra **http://localhost:5173** e ingrese con `ana@empresa.co` y la contraseña `Viaticos2026*`. Usuarios por rol y solución de problemas en [docs/desarrollo-local.md](docs/desarrollo-local.md).

## Pruebas

```bash
# API (PostgreSQL y Redis reales; ver apps/api/CLAUDE.md)
cd apps/api && python -m pytest -q --cov
ruff check . && mypy && lint-imports

# Web
pnpm install && pnpm typecheck && pnpm test && pnpm build
```

La documentación interactiva de la API está en `/docs` (Swagger) y el contrato en `apps/api/docs/API_CONTRACT.md`.
