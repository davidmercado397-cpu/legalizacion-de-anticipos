# Desarrollo local con Docker

Con un solo comando se levanta todo el sistema en su equipo: base de datos, API y web, con **recarga en caliente** (cada cambio que guarde se refleja en segundos).

## 1. Requisitos

| Herramienta | Versión | Notas |
|-------------|---------|-------|
| [Git](https://git-scm.com/downloads) | cualquiera reciente | |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / Mac) o Docker Engine (Linux) | Compose **2.22 o superior** | Verifique con `docker compose version` |
| Node.js 22 + pnpm *(opcional)* | Node ≥ 22.12 | Solo para que el editor tenga autocompletado o para correr sin Docker |

**Windows:** Docker Desktop debe usar el motor **WSL 2** (viene así por defecto). Clonar el repositorio dentro de WSL (`\\wsl$\Ubuntu\home\...`) hace todo más rápido, pero también funciona en `C:\`.

## 2. Primer arranque

```bash
git clone https://github.com/davidmercado397-cpu/legalizacion-de-anticipos.git
cd legalizacion-de-anticipos

# Copie la configuración de ejemplo
cp .env.example .env              # PowerShell: Copy-Item .env.example .env

# Levante todo (la primera vez descarga imágenes y dependencias: unos minutos)
docker compose up --build --watch
```

Cuando vea `API en http://localhost:3000/api/v1` (es la dirección *dentro* del contenedor), abra **http://localhost:5173**.

### Usuarios de prueba

Contraseña de todos: **`Viaticos2026*`**

| Correo | Rol | Para probar |
|--------|-----|-------------|
| `ana@empresa.co` | Viajera (Analista) | Crear solicitudes |
| `carlos@empresa.co` | Jefe inmediato de Ana | Primera aprobación |
| `diana@empresa.co` | Jefa directiva | Aprobación cuando se supera la tarifa |
| `tomas@empresa.co` | Tesorería | Registrar el desembolso del anticipo |
| `laura@empresa.co` | Contabilidad | Revisar y aprobar legalizaciones; configurar NIT, topes y exclusiones |
| `gabriela@empresa.co` | Gerencia | Aprobar los viajes de directivos (por ejemplo, los de Diana) |

**Conciliación bancaria:** en una legalización con facturas pagadas con tarjeta, use *Cargar extracto* y suba un CSV o Excel del banco. El sistema propone las columnas, cruza los cargos con las facturas y contabilidad revisa el resultado en *Contabilidad → Conciliaciones bancarias*.

**Caso de ejemplo:** con Ana, cree un viaje a Brasil y cambie el alojamiento a 50 USD por noche (la tarifa es 30). La solicitud pedirá justificación y la verán Carlos y Diana: Carlos aprueba primero, aunque Diana puede aprobar sin esperarlo. La moneda del anticipo la define el destino: pesos para viajes en Colombia, dólares si algún destino es en el exterior.

### Lectura automática de facturas (opcional)

Por defecto el viajero digita los datos de cada factura. Para que se lean solas con IA:

1. Cree una API key en https://console.anthropic.com.
2. En `.env`, ponga `OCR_PROVEEDOR=claude` y `ANTHROPIC_API_KEY=su-clave`.
3. Reinicie: `docker compose up --build --watch`.

El costo estimado es de unos USD 0,04–0,06 por factura. `OCR_ESFUERZO=low` lo reduce, con algo menos de precisión.

### Tasas de cambio (TRM del día)

Por defecto (`TASAS_PROVEEDOR=oficial`) la API toma la **TRM del día** de datos.gov.co y las demás monedas del Banco Central Europeo. Las consulta al arrancar y luego cada hora, y las muestra en *Nueva solicitud*. Necesita internet.

Sin internet, ponga `TASAS_PROVEEDOR=fija` en `.env`: se usará `TRM_DESARROLLO`.

## 3. Qué se levanta

| Servicio | URL / puerto | Qué hace |
|----------|--------------|----------|
| `web` | http://localhost:5173 | React 19 con Vite. Reenvía `/api` a la API |
| `api` | http://localhost:5173/api/v1 (a través de la web) | NestJS con recarga en caliente. No publica puerto propio para no chocar con otros proyectos |
| `db` | `localhost:5432` | PostgreSQL 17. Los datos persisten en el volumen `viaticos_db-data` |
| — | volumen `viaticos_almacen-data` | Fotos y PDF de las facturas |
| `migraciones` | — | Aplica migraciones y carga datos de prueba, y termina |
| `adminer` *(opcional)* | http://localhost:8080 | Explorador web de la base de datos |

Los puertos se cambian en `.env` (`WEB_PORT`, `DB_PORT`) si ya los usa otra aplicación.

## 4. Trabajo diario

- **Editar código:** guarde el archivo y listo. `--watch` sincroniza `apps/*/src` y `packages/*/src` dentro de los contenedores, y la API o la web se recargan solas.
- **Agregar una dependencia:** ejecute `pnpm add` (o edite el `package.json`). Al cambiar `pnpm-lock.yaml`, Compose reconstruye la imagen automáticamente.
- **Cambiar el esquema de base de datos:**
  1. Edite el `*.schema.ts` del módulo.
  2. Genere la migración **en su equipo**: `pnpm install` (solo la primera vez) y luego `pnpm db:generar`. Se crea un `.sql` en `apps/api/drizzle/`, que se sube al repositorio.
  3. Aplíquela: `docker compose up migraciones`.

  No la genere dentro del contenedor: `--watch` copia del equipo al contenedor, no al revés, y el archivo se perdería.
- **Detener:** `Ctrl+C`, o `docker compose down`. Los datos se conservan.
- **Empezar con la base limpia:** `docker compose down -v` y luego de nuevo `docker compose up --build --watch`.

### Comandos útiles

```bash
docker compose logs -f api                          # ver logs de la API
docker compose exec db psql -U viaticos viaticos    # consola SQL
docker compose --profile herramientas up -d adminer # explorador web de la BD (servidor: db)
docker compose exec api pnpm test                   # pruebas unitarias dentro del contenedor
```

Atajos equivalentes con pnpm, si lo tiene instalado: `pnpm docker:dev`, `pnpm docker:bajar`, `pnpm docker:reiniciar-datos`.

## 5. Pruebas

```bash
pnpm install                 # una vez, en su equipo
pnpm test                    # unitarias + e2e en memoria (no necesitan Docker)
docker compose up -d db
pnpm test:integracion        # contra PostgreSQL real (usa TEST_DATABASE_URL del .env)
pnpm typecheck
```

## 6. Sin Docker para la API y la web (opcional)

Útil para depurar con breakpoints desde el editor:

```bash
docker compose up -d db     # solo la base de datos
pnpm install
pnpm db:migrar && pnpm db:sembrar
pnpm dev:api                # terminal 1  → http://localhost:3000
pnpm dev:web                # terminal 2  → http://localhost:5173
```

## 7. Probar las imágenes de producción en local

```bash
docker compose -f docker-compose.prod.yml up --build -d    # → http://localhost:8080
docker compose -f docker-compose.prod.yml down -v
```

Usa las mismas imágenes que se desplegarán:

- **API:** compilada, sin herramientas de desarrollo, ejecutada como usuario sin privilegios.
- **Web:** estáticos servidos por nginx, con cabeceras de seguridad (CSP).

## 8. Problemas comunes

| Síntoma | Solución |
|---------|----------|
| `port is already allocated` | Otro programa usa el puerto: cambie `WEB_PORT` o `DB_PORT` en `.env` |
| `http proxy error … getaddrinfo ENOTFOUND api` | La web no encuentra la API en la red de Docker. Ejecute `docker compose down` y `docker compose up --build --watch`; si persiste, `docker compose up --force-recreate --no-deps api` muestra el error de Docker |
| `TASA_NO_DISPONIBLE` al estimar un viaje | La API no pudo consultar la TRM. Revise la conexión a internet o use `TASAS_PROVEEDOR=fija` en `.env` |
| `Defina JWT_SECRET en .env` | No copió `.env.example` a `.env` |
| `unknown flag: --watch` | Actualice Docker Desktop (se necesita Compose ≥ 2.22) |
| Los cambios no se reflejan | Asegúrese de haber arrancado con `--watch` |
| Errores raros de scripts en Windows | El repositorio fuerza finales de línea LF (`.gitattributes`). Si clonó antes de que existiera, ejecute `git rm --cached -r . && git reset --hard` |
| Quiero datos limpios | `docker compose down -v` |
