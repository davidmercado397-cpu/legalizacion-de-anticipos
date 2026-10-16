# Contrato de la API (para el frontend)

OpenAPI en vivo: `/docs` y `/openapi.json`. Prefijo: `/api/v1`. Autenticación: `Authorization: Bearer <access_token>`.

## Respuestas de error

Todas las respuestas de error tienen la misma forma, sin importar el código HTTP:

```json
{
  "error": {
    "code": "pending_expenses",
    "message": "Antes de enviar la legalización, confirma o descarta los 3 gastos pendientes.",
    "details": [],
    "request_id": "7f3c9a1b2c4d4e5f8a9b0c1d2e3f4a5b"
  }
}
```

- `code`: estable; el frontend decide qué hacer con él (no comparar `message`).
- `message`: en español, listo para mostrar al usuario.
- `details`: en errores 422, un elemento por campo (`{"field": "email", "issue": "Este campo es obligatorio."}`);
  en 503, el servicio que falta (`{"service": "r2"}`).
- `request_id`: el mismo de la cabecera `X-Request-ID` y de los logs. Si un usuario reporta un error, con este id se
  encuentra la petición.

| HTTP | Cuándo | Códigos típicos |
|---|---|---|
| 401 | Sin sesión o sesión vencida (renovar con `/auth/refresh` o volver al login) | `session_expired`, `login_required`, `invalid_credentials` |
| 403 | El rol no tiene el permiso, o la acción está prohibida sobre algo que sí ve | `forbidden`, `self_decision`, `owner_only`, `password_change_required` |
| 404 | No existe **o está fuera de la visibilidad del usuario** (nunca se confirma que existe) | `not_found` |
| 409 | Estado inválido o conflicto | `invalid_advance_transition`, `pending_expenses`, `justification_required`, `policy_blocked`, `email_taken` |
| 422 | Datos inválidos | `validation_error` (con `details`), `password_too_short`, `file_too_large`, `unsupported_file_type` |
| 423 | Cuenta bloqueada por intentos fallidos (cabecera `Retry-After`) | `account_locked` |
| 429 | Demasiadas peticiones (cabecera `Retry-After`) | `rate_limited` |
| 500 | Error interno (se muestra el `request_id` al usuario) | `internal_error` |
| 502 | Un servicio externo falló | `ai_unavailable`, `whatsapp_unavailable`, `external_service_error` |
| 503 | Una integración no está configurada en este ambiente | `service_not_configured` |

El catálogo completo de códigos y textos está en [`MENSAJES.md`](MENSAJES.md) (generado desde
`app/application/messages.py`).

## Listados

Todos los listados devuelven un objeto, nunca un arreglo suelto:

```json
{ "data": [ ... ], "pagination": { "limit": 50, "offset": 0, "total": 134 } }
```

- Paginados (`?limit=` 1–200, `?offset=`): `/expenses`, `/advances`, `/employees`, `/audit`.
- Sin paginación (listas cortas): solo `{"data": [...]}`. Por ejemplo `/companies`, `/me/balances`,
  `/expenses/{id}/lines`, `/companies/{id}/policy-rules` y `/companies/{id}/blocked-concepts`.

## Cabeceras

- `X-Request-ID`: el frontend puede enviar uno propio (8–64 caracteres alfanuméricos o guiones); si no, la API lo
  genera. Siempre vuelve en la respuesta.
- `Retry-After`: en 423 y 429, segundos a esperar.

## Archivos

`GET /expenses/{id}/file` responde 307 hacia una URL firmada de R2 de corta duración. La imagen nunca pasa por la API.
Los gastos traen además `file` (`url` del original, `thumbnail_url` de la miniatura JPEG, `mime_type` y
`expires_at`): URLs firmadas que se usan directo en `<img>` o en un visor de PDF y caducan pronto. Si
caducaron, se vuelve a pedir el recurso. Los PDF no tienen miniatura (`thumbnail_url: null`).

## Fechas y horas

- Todo se guarda en UTC. Las lecturas de anticipos y gastos (`GET /advances`, `GET /advances/{id}`,
  `GET /advances/{id}/timeline`, `GET /expenses`, `GET /expenses/{id}`) devuelven las fechas en ISO 8601
  **con el offset de la zona horaria de la compañía** (p. ej. `2026-10-13T21:47:00-05:00` en Colombia).
  El detalle incluye `company_timezone`. Las demás respuestas pueden traerlas en UTC: es el mismo
  instante, cualquier librería de fechas las compara bien.
- `reported_at` es cuándo el usuario envió el gasto: la hora del mensaje de WhatsApp (si el celular no
  tenía señal, la hora en que se recuperó la conexión) o la que manda la app. `created_at` es cuándo
  llegó al servidor. La fecha real del gasto es la de la factura (`invoice_date` e `invoice_time`).
- Las fechas sin hora (`invoice_date`, `start_date`) son fechas de negocio de la compañía.
