# Desarrollo local con Docker

Con un solo comando se levanta todo el sistema: PostgreSQL, Redis, SeaweedFS (almacenamiento compatible con S3 que reemplaza a Cloudflare R2 en desarrollo), la API Python y la web, con **recarga en caliente**.

## 1. Requisitos

| Herramienta | Versión | Notas |
|-------------|---------|-------|
| [Git](https://git-scm.com/downloads) | cualquiera reciente | |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / Mac) o Docker Engine (Linux) | Compose **2.23.1 o superior** | Verifique con `docker compose version` |
| Python 3.13 y Node 22 + pnpm *(opcional)* | | Solo para correr pruebas o trabajar sin Docker |

**Windows:** Docker Desktop debe usar el motor **WSL 2** (viene así por defecto).

## 2. Primer arranque

```bash
git clone https://github.com/davidmercado397-cpu/legalizacion-de-anticipos.git
cd legalizacion-de-anticipos
cp .env.example .env              # PowerShell: Copy-Item .env.example .env
docker compose up --build --watch
```

Al arrancar, la API aplica las migraciones y crea los datos de desarrollo. Luego abra **http://localhost:5173**.

### Usuarios de prueba

Contraseña de todos: **`Viaticos2026*`**

| Correo | Rol | Para probar |
|--------|-----|-------------|
| `ana@empresa.co` | Empleada (viajera) | Solicitar anticipos y registrar facturas |
| `carlos@empresa.co` | Aprobador, jefe de Ana | Aprobar la solicitud de Ana |
| `diana@empresa.co` | Aprobadora, jefa de Carlos (jefe directivo de Ana) | Aprobar lo que escala, sin esperar a Carlos |
| `gabriela@empresa.co` | Gerencia | Aprobar los viajes de Diana, que no tiene jefe |
| `tomas@empresa.co` | Tesorería | Registrar el desembolso y el reintegro o reembolso |
| `laura@empresa.co` | Contabilidad | Revisar y cerrar legalizaciones, política de gastos |
| `andres@empresa.co` | Administrador | Usuarios y compañías |

La solicitud la aprueba el jefe inmediato. Si supera en más del 10 % el presupuesto calculado, o el monto que fije contabilidad en *Contabilidad → Escalamiento al jefe directivo*, también la aprueba el jefe directivo, que puede hacerlo sin esperar. El jefe solo aprueba la solicitud. Cuando el viajero envía la legalización, la revisa y la cierra contabilidad, y tesorería registra el reintegro o el reembolso de la diferencia.

### Lectura de facturas con IA (opcional)

Ponga su clave de [OpenRouter](https://openrouter.ai) en `.env` (`OPENROUTER_API_KEY=...`) y reinicie. Sin clave, la API responde que la lectura no está configurada y los datos se digitan a mano.

## 3. Qué se levanta

| Servicio | URL / puerto | Qué hace |
|----------|--------------|----------|
| `web` | http://localhost:5173 | React con Vite. Reenvía `/api` a la API |
| `api` | http://localhost:5173/api/v1 (a través de la web) | FastAPI con recarga en caliente |
| `db` | `localhost:5432` | PostgreSQL 18 (usuario y clave `gastos`) |
| `redis` | — | Límites de peticiones y caché compartida |
| `s3` | http://localhost:9000 | SeaweedFS: fotos y PDF de las facturas (llave `viaticos`, secreto `viaticos-local`, bucket `soportes`) |
| `adminer` *(opcional)* | http://localhost:8080 | Explorador de la base de datos: `docker compose --profile herramientas up -d adminer` |

## 4. Trabajo diario

- **Editar código:** guarde y listo; `--watch` sincroniza `apps/api/app`, `apps/web/src` y `packages/`.
- **Cambiar el esquema:** cree la migración en `apps/api/alembic/versions` (ver `apps/api/CLAUDE.md`). Compose reconstruye la API al detectar el cambio.
- **Empezar con datos limpios:** `docker compose down -v` y de nuevo `docker compose up --build --watch`.

```bash
docker compose logs -f api                       # logs de la API
docker compose exec db psql -U gastos gastos     # consola SQL
```

## 5. Pruebas sin Docker

```bash
# API: requiere PostgreSQL y Redis locales (o: docker compose up -d db redis)
cd apps/api
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgresql+asyncpg://gastos:gastos@localhost:5432/gastos_test .venv/bin/python -m pytest -q

# Web
pnpm install && pnpm typecheck && pnpm test
```

## 6. Problemas comunes

| Síntoma | Solución |
|---------|----------|
| `port is already allocated` | Cambie `WEB_PORT`, `DB_PORT` o `S3_PORT` en `.env` |
| Las fotos no cargan en el navegador | Las URLs firmadas apuntan a `localhost:9000`: revise que el servicio `s3` esté arriba y que `S3_PORT` coincida |
| `unknown flag: --watch` o error en `configs` | Actualice Docker Desktop (Compose ≥ 2.23.1) |
| Quiero datos limpios | `docker compose down -v` |
