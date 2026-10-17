# Despliegue en Coolify

Todo el sistema se despliega como **un solo recurso «Docker Compose»** con el archivo `docker-compose.prod.yml`. La web (nginx) es lo único que se publica; reenvía `/api` y `/webhooks` a la API por la red interna, así que basta **un dominio**.

## 1. Crear el recurso

1. *New Resource → Public/Private Repository* → este repositorio, rama `main`.
2. **Build Pack:** Docker Compose. **Docker Compose Location:** `/docker-compose.prod.yml`.
3. En el servicio **web**, ponga el dominio (p. ej. `https://viaticos.empresa.co:8080`; Coolify usa el `:8080` para saber a qué puerto del contenedor enviar el tráfico y publica en 443 con HTTPS).
4. Llene las variables (sección 3) y despliegue.

## 2. Puertos

| Servicio | Puerto del contenedor | ¿Público? | Qué es |
|---|---|---|---|
| `web` | **8080** | **Sí**: el dominio apunta aquí | nginx: la web, `/api/*` y `/webhooks/*` hacia la API |
| `api` | 8000 | No | FastAPI; al arrancar aplica las migraciones |
| `db` | 5432 | No | PostgreSQL 18 (volumen `postgres-data`) |
| `redis` | 6379 | No | Límites de peticiones y caché (no guarda datos) |

No publique la API, la base ni Redis. Para entrar a la base use la terminal de Coolify (`psql -U gastos gastos` en `db`).

## 3. Variables

### Obligatorias

| Variable | Valor |
|---|---|
| `APP_URL` | URL pública de la web, con `https://` y sin `/` final: `https://viaticos.empresa.co` |
| `POSTGRES_PASSWORD` | Contraseña larga y aleatoria de la base (no la cambie después del primer despliegue: el volumen ya la tiene) |
| `JWT_SECRET` | 48+ caracteres aleatorios: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `MFA_ENCRYPTION_KEY` | Llave Fernet: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. **Guárdela**: si se pierde, todos deben volver a activar la verificación en dos pasos |
| `R2_ENDPOINT_URL` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | Nombre del bucket de R2 (privado) |
| `R2_ACCESS_KEY_ID` | Token de R2 con permiso de lectura y escritura sobre el bucket |
| `R2_SECRET_ACCESS_KEY` | Secreto de ese token |

### Integraciones (sin ellas la app funciona; lo que dependa responde que no está configurado)

| Variable | Valor |
|---|---|
| `OPENROUTER_API_KEY` | Clave de OpenRouter (`sk-or-...`) para leer facturas con IA |
| `WHATSAPP_VERIFY_TOKEN` | Texto aleatorio; el mismo que se pone en Meta |
| `WHATSAPP_APP_SECRET` | App Secret de la app de Meta (firma de los mensajes; sin él se rechazan) |
| `WHATSAPP_ACCESS_TOKEN` | Token permanente del usuario del sistema de Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número de WhatsApp |

### Opcionales (ya traen un valor por defecto)

| Variable | Por defecto | Para qué |
|---|---|---|
| `MFA_REQUIRED_ROLES` | `admin,accountant,treasury,superadmin` | Roles que deben activar la verificación en dos pasos |
| `WEB_CONCURRENCY` | `2` | Procesos de la API (uno por núcleo, aprox.) |
| `LOG_LEVEL` | `INFO` | Detalle del log |
| `FILES_ORIGIN` | `https://*.r2.cloudflarestorage.com` | Origen de las fotos firmadas que el navegador puede mostrar; cámbielo solo si usa otro almacenamiento S3 |
| `MIGRATION_DATABASE_URL` | vacío | Roles separados en la base (ver sección 6) |

Las demás opciones (modelos de IA, plantillas de WhatsApp, umbrales) no van aquí: las cambia el superadmin en *Plataforma → Configuración*.

## 4. Servicios externos

- **R2:** un bucket privado (sin acceso público). El navegador muestra las fotos con URLs firmadas de 5 minutos; no hace falta configurar CORS.
- **WhatsApp (Meta):** URL de devolución de llamada `https://<su dominio>/webhooks/whatsapp`, con el mismo `WHATSAPP_VERIFY_TOKEN`; suscríbase al campo `messages`.

## 5. Primer arranque

Después del primer despliegue, en la terminal de Coolify del servicio **api**:

```bash
python -m app.cli create-admin --email admin@empresa.co --name "Nombre" --company "Razón social S.A.S." --country CO --currency COP
python -m app.cli create-superadmin --email soporte@nextbyte.co --name "Operación NextByte"
python -m scripts.check_ai      # si configuró OPENROUTER_API_KEY
```

Cada comando pide la contraseña (mínimo 10 caracteres, sin el correo dentro). Al entrar, el admin y el superadmin activan la verificación en dos pasos. Los datos de prueba de desarrollo (`seed_dev`) no corren en producción.

## 6. Antes de usarlo con datos reales

- **Respaldos:** programe el respaldo diario de la base (desde Coolify si su versión lo ofrece para el servicio `db`, o con `apps/api/scripts/backup_db.sh`) y pruebe restaurar uno (`apps/api/scripts/restore_drill.sh`).
- **Roles separados en la base (recomendado):** la API con un rol sin permisos de cambiar el esquema y las migraciones con otro (`apps/api/scripts/db_roles.sql`, variable `MIGRATION_DATABASE_URL`). Conviene dejarlo hecho antes de cargar datos reales.
- **Cada versión nueva** aplica las migraciones al arrancar: haga un respaldo antes de desplegar cambios de esquema.
