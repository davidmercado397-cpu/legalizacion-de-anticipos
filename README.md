# Viáticos: legalización de anticipos

Proyección de viajes con presupuesto por cargo × país × concepto, aprobaciones por niveles, creación del anticipo en Siesa Enterprise, radicación de soportes con OCR, detección de duplicados, conciliación con extractos y legalización.

- Plan y alcance: [docs/plan.md](docs/plan.md)
- Decisiones de arquitectura: [docs/adr](docs/adr)

## Inicio rápido (Docker)

```bash
git clone https://github.com/davidmercado397-cpu/legalizacion-de-anticipos.git
cd legalizacion-de-anticipos
cp .env.example .env
docker compose up --build --watch
```

Abra **http://localhost:5173** e ingrese con `ana@empresa.co` y la contraseña `Viaticos2026*`. Guía completa (Windows incluido), usuarios de prueba y solución de problemas: **[docs/desarrollo-local.md](docs/desarrollo-local.md)**.

## Comandos (con Node 22 + pnpm en su equipo)

```bash
pnpm install
pnpm test               # unitarias + e2e en memoria
pnpm test:integracion   # contra PostgreSQL (docker compose up -d db)
pnpm typecheck          # TypeScript estricto en todo el monorepo
pnpm build              # bundles de producción (API y web)
pnpm db:generar         # nueva migración a partir de los *.schema.ts
```

## Estructura

```
apps/api/            NestJS · monolito modular con arquitectura limpia
  src/modules/<contexto>/{domain,application,infrastructure,presentation}
  drizzle/           migraciones SQL versionadas
  test/              e2e, prueba de arquitectura e integración (PostgreSQL)
apps/web/            React 19 · TanStack Router/Query · RHF + Zod · Tailwind (PWA responsive)
packages/
  shared-kernel/     Money (decimal exacto), monedas, fechas, tasas, errores de dominio
  contracts/         esquemas Zod compartidos por API, web y (futuro) móvil
  client-api/        cliente axios: token, renovación, errores RFC 7807
  client-app/        sesión (Zustand) y hooks de TanStack Query (reutilizable en React Native)
docker/              imagen de desarrollo, nginx, init de PostgreSQL
```

## API

Autenticación: `POST /auth/login` devuelve el access token (Bearer). La web recibe el refresh token en una cookie httpOnly; la app móvil, en el cuerpo (`x-cliente: movil`). Para pruebas rápidas con curl existe el modo `AUTH_MODE=dev` el usuario se indica con la cabecera `x-usuario-id`. Este modo está prohibido en producción: la app no arranca. Usuarios de prueba:

| Usuario | Rol |
|---------|-----|
| `u-viajero` (ana@empresa.co) | Analista; jefe inmediato `u-jefe`, jefe directivo `u-directivo` |
| `u-jefe` (carlos@empresa.co) | Coordinador / aprobador |
| `u-directivo` (diana@empresa.co) | Director / aprobador |
| `u-contabilidad` (laura@empresa.co) | Contabilidad |

```bash
# Estimado: hotel a 50 USD/noche en Brasil (tarifa 30) → escala a jefe directivo
curl -s -X POST localhost:3000/api/v1/solicitudes/estimar \
  -H 'content-type: application/json' -H 'x-usuario-id: u-viajero' \
  -d '{"monedaAnticipo":"COP","destinos":[{"paisCodigo":"BR","ciudad":"São Paulo",
       "fechaInicio":"2026-11-02","fechaFin":"2026-11-06",
       "valoresSolicitados":[{"conceptoCodigo":"ALOJAMIENTO","valorUnitario":"50"}]}]}'
```

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/login` · `/auth/refresh` · `/auth/logout` | Sesión |
| GET | `/auth/me` | Perfil del usuario autenticado |
| GET | `/solicitudes/destinos-disponibles` | Países con tarifa para el cargo del usuario |
| POST | `/solicitudes/estimar` | Proyecta el viaje (no persiste) |
| POST | `/solicitudes` | Crea y envía a aprobación |
| GET | `/solicitudes` | Mis solicitudes |
| GET | `/solicitudes/:id` | Detalle (viajero o aprobadores) |
| POST | `/solicitudes/:id/aprobar` · `/rechazar` · `/cancelar` | Decisiones |
| GET | `/aprobaciones/pendientes` | Bandeja del aprobador |
| POST | `/comprobantes/duplicados/verificar` | Verificación de duplicados |
| GET | `/salud` | Health check (público) |

Los errores siguen RFC 7807 (`application/problem+json`) con un `code` estable para i18n.
