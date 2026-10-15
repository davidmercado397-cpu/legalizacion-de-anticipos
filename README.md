# Viáticos: legalización de anticipos

Proyección de viajes con presupuesto por cargo × país × concepto, aprobaciones por niveles, creación del anticipo en Siesa Enterprise, radicación de soportes con OCR, detección de duplicados, conciliación con extractos y legalización.

- Plan y alcance: [docs/plan.md](docs/plan.md)
- Decisiones de arquitectura: [docs/adr](docs/adr)

## Requisitos

- Node.js ≥ 22.12
- pnpm 10 (`corepack enable`)

## Comandos

```bash
pnpm install
pnpm test          # pruebas de todos los paquetes
pnpm typecheck     # TypeScript estricto en todo el monorepo
pnpm dev:api       # API en http://localhost:3000/api/v1 (modo de autenticación de desarrollo)
pnpm build         # bundle de producción de la API (apps/api/dist)
```

## Estructura

```
apps/api/                     NestJS (monolito modular, arquitectura limpia)
  src/modules/<contexto>/{domain,application,infrastructure,presentation}
  test/arquitectura.spec.ts   falla si se rompe la regla de dependencia
packages/shared-kernel/       Money (decimal exacto), monedas, fechas, tasas de cambio, errores de dominio
packages/contracts/           Esquemas Zod compartidos por la API y los formularios
```

## Probar la API en desarrollo

En modo `AUTH_MODE=dev` el usuario se indica con la cabecera `x-usuario-id`. Este modo está prohibido en producción: la app no arranca. Usuarios de prueba:

| Usuario | Rol |
|---------|-----|
| `u-viajero` | Analista; jefe inmediato `u-jefe`, jefe directivo `u-directivo` |
| `u-jefe` | Coordinador / aprobador |
| `u-directivo` | Director / aprobador |
| `u-contabilidad` | Contabilidad |

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
| POST | `/solicitudes/estimar` | Proyecta el viaje (no persiste) |
| POST | `/solicitudes` | Crea y envía a aprobación |
| GET | `/solicitudes` | Mis solicitudes |
| GET | `/solicitudes/:id` | Detalle (viajero o aprobadores) |
| POST | `/solicitudes/:id/aprobar` · `/rechazar` · `/cancelar` | Decisiones |
| GET | `/aprobaciones/pendientes` | Bandeja del aprobador |
| POST | `/comprobantes/duplicados/verificar` | Verificación de duplicados |
| GET | `/salud` | Health check (público) |

Los errores siguen RFC 7807 (`application/problem+json`) con un `code` estable para i18n.
