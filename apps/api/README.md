# API de Anticipos y Gastos de Viaje

API (sin frontend) para solicitar y aprobar **anticipos**, registrar **gastos** con la foto de la
factura (por la app o por **WhatsApp**), leerlos con **IA** y llevar el **saldo por legalizar** de
cada anticipo en línea. Un solo cliente (Forsa) con varias compañías (Colombia, Panamá, México).

- **Stack:** Python 3.13 · FastAPI · PostgreSQL · SQLAlchemy 2 (async) · Alembic · httpx.
- **Integraciones:** WhatsApp Cloud API (Meta), Cloudflare R2 (archivos), OpenRouter (IA de visión).
- **Arquitectura:** hexagonal (dominio → casos de uso → adaptadores), SOLID, KISS.
- **Documentación interactiva:** `/docs` (Swagger) y `/openapi.json` (para generar el cliente del frontend).

## Estado

| Entrega | Contenido | Estado |
|---|---|---|
| **1. Núcleo** | Auth + roles + rate limit, compañías, CRUD de usuarios, identidad WhatsApp (BSUID), anticipos con aprobación (API y WhatsApp), gasto por foto → R2 → lectura híbrida (QR + IA con escalamiento) → confirmar → saldo | ✅ |
| **2. Control** | Líneas de detalle, reglas de política configurables, conceptos bloqueados, justificación, revisión del aprobador, deducibilidad, legalización y Excel | ✅ |
| **Seguridad** | MFA para roles con privilegios, auditoría inmutable, mínimo privilegio en BD, respaldos, CI de seguridad y expediente para el cliente (`docs/security/`) | ✅ |
| **3a. Inteligencia y operación** | Países y categorías por compañía, extracción v3 (ES/EN/PT), tasas de cambio automáticas, presupuestos de viaje, detalle de la legalización con fotos y línea de tiempo, anular/reabrir, tesorería y suplentes, deducibilidad por adquiriente y por línea, tableros, uso, aprendizaje por correcciones y set de evaluación | ✅ |
| **3b. Experiencia de WhatsApp** | Detalle por factura con [Está bien] [Corregir], duplicado propio, anticipo por fecha, menú por rol y sesión, WhatsApp Flows (corregir, justificar, solicitar), avisos de estado, recordatorios y costo de la IA por modelo y compañía | ✅ |

Catálogo de casos de uso por rol, con su canal y endpoint: `docs/USE_CASES.md`.

## Arquitectura

```
app/
  domain/        Entidades y reglas (sin frameworks): Employee, Advance, Expense, verificaciones,
                 NIT/CUFE/QR fiscales, permisos por rol, puertos (Protocols)
  application/   Casos de uso: auth, usuarios, anticipos, gastos, lectura híbrida, procesamiento,
                 notificaciones, identidad WhatsApp, bot (cadena de handlers), barrido de reintentos
  adapters/
    inbound/     HTTP (FastAPI: routers, esquemas, deps, errores) y webhook de WhatsApp (firma + parser)
    outbound/    PostgreSQL (mapeo imperativo + repositorios + Unit of Work), R2, OpenRouter,
                 Graph API de WhatsApp, Pillow + zxing (imagen y QR), Argon2, JWT, rate limiter
  container.py   Composition root (cablea adaptadores y casos de uso)
  main.py        App FastAPI + lifespan (barrido de reintentos)
prompts/         Prompts versionados de la IA (invoice_extraction/vN.md)
alembic/         Migraciones (PostgreSQL)
scripts/         try_extraction.py (prueba rápida con fotos reales), extraction_eval.py (set de evaluación),
                 respaldos, simulacro de restauración, roles de BD y evidencia de seguridad
tests/           unit/ + integration/ + security/ (PostgreSQL real; IA, WhatsApp y R2 simulados)
```

**Patrones:** Ports & Adapters, Repository + Unit of Work, Strategy (enrutamiento de modelos,
almacenamiento), Decorator/Chain (escalamiento de la IA), Chain of Responsibility (bot), Observer
(notificaciones).

### Flujo de una foto por WhatsApp

1. Meta → `POST /webhooks/whatsapp`: se valida la firma HMAC sobre el cuerpo crudo, se responde
   200 al instante y se procesa en segundo plano. Los reintentos de Meta se ignoran (idempotencia).
2. Se identifica al remitente por **BSUID** (o por teléfono, y se vincula el BSUID). Si no está
   registrado, no se crea nada ni se gasta IA.
3. En menos de 1 s: doble check azul, "escribiendo…" y reacción ⏳ sobre su foto.
4. Se descarga el archivo de Meta. Si es **la misma foto** que el empleado ya envió (sha256), se
   descarta sin gastar IA y se le dice "ya la tengo registrada". Si no, **en paralelo** se archiva
   el original en R2 y se lee:
   - preprocesamiento (rotación, tamaño, foto borrosa → se pide reenviar sin gastar IA);
   - QR fiscal (DIAN / SAT / DGI): datos exactos y gratis;
   - **enrutamiento por dificultad:** con QR legible → `gemini-3.5-flash-lite` (rápido);
     sin QR → `gemini-3.8-flash`;
   - verificaciones determinísticas (aritmética, dígito de verificación del NIT, fechas, CUFE,
     total contra el QR) → si fallan o la confianza es baja, **escala** al modelo con razonamiento
     y la imagen en alta resolución.
5. Se guarda el gasto (y cada intento de IA con modelo, versión de prompt, tokens, costo y tiempos).
   La misma factura que el empleado ya registró (CUFE) se descarta sola. Se asigna al único anticipo
   abierto o, con varios, al único cuyo viaje cubre la fecha de la factura (con la tolerancia de la
   regla de fechas). La reacción cambia a ✅ / ⚠️ / ❌.
6. Al terminar la ráfaga de fotos, **un mensaje por factura**: proveedor, NIT, fecha y hora, número,
   hasta 10 líneas, base, cada impuesto con su tarifa, propina, total (y su equivalente si es otra
   moneda), alertas y el saldo del anticipo al confirmar; sin CUFE. Botones [✅ Está bien]
   [✏️ Corregir] (o [✍️ Justificar] si la política lo pide, y [🔁 Cambiar anticipo] si se asignó
   por la fecha). Los recibos sin QR resaltan el total y la fecha para que el usuario los revise.
   Nada se confirma solo. Si la fecha no define el anticipo, el bot pregunta a cuál va.
7. Recordatorio de legalizar `whatsapp.reminder_days` días después del fin del viaje (por defecto 1
   y 3), con el avance y un botón [📤 Enviar a revisión].

### Conversación y menú

- **Sesión:** el primer mensaje, o el primero tras `whatsapp.session_ttl_minutes` (15) sin escribir
  o tras despedirse, recibe "Hola {nombre} 👋 Soy {whatsapp.assistant_name}…" y el menú. Dentro de la
  conversación, cualquier texto que no se entienda muestra el menú.
- **Menú** (lista interactiva según el rol): 💰 Mis anticipos, 💵 Saldo (también en la moneda de la
  compañía), 📝 Pendientes, 🧾 Mis gastos (ver, corregir, descartar), ➕ Solicitar anticipo,
  📤 Enviar legalización (resumen y [📤 Enviar]; si quedan gastos sin confirmar, lo dice) y, para
  aprobadores, ✅ Por aprobar (cada solicitud del equipo, o de quien suple, con [Aprobar]
  [Rechazar]; las legalizaciones en revisión se revisan en la app).
- **Palabras clave** (`whatsapp.keywords`, sin importar tildes ni mayúsculas): "saldo",
  "pendientes", "mis gastos", "anticipos", "menú"… y la despedida ("gracias", "listo", "chao"), que
  cierra la conversación.
- **Inactividad:** una tarea cierra las conversaciones inactivas; si quedaron gastos por confirmar
  o una foto ilegible, recuerda **una sola vez** con [📝 Ver pendientes].
- **Avisos de estado** (después de cada cambio, por la ventana de 24 h o la plantilla de aviso): al
  empleado cuando su anticipo se aprueba (con la razón social y el NIT a los que debe pedir las
  facturas), se rechaza, se anula, se entrega, se le devuelve la legalización (con los gastos
  marcados y [↩️ Ver marcados]) o se cierra (con el reintegro, el saldo a su favor o "en cero"); al
  aprobador cuando recibe una legalización o la recibe corregida (cuántas marcas quedaron sin
  resolver). La solicitud nueva sigue llegando con la plantilla de aprobación. Si el aviso salió por
  plantilla, el mensaje completo (motivo, botones) queda guardado y se entrega cuando el empleado toca
  [Ver detalle] o escribe cualquier cosa, antes de responderle; vence a los `whatsapp.notice_hold_days`.

## Políticas de gasto (incremento 2)

La IA **solo extrae hechos** (cabecera y líneas de la factura, y clasifica cada línea contra los
conceptos bloqueados de la compañía por significado: "Club Colombia" es cerveza). Las **reglas las
aplica código determinístico**: cada hallazgo guarda la regla, la acción y los parámetros que lo
dispararon (auditable y repetible). Sin RAG para aplicar políticas.

Contabilidad configura por compañía (`PUT /api/v1/companies/{id}/policy-rules`) la **acción** de
cada regla (`warn`, `require_justification`, `review`, `block`), sus **parámetros** y si está activa.
`review` no frena al viajero: el gasto queda marcado para que contabilidad lo decida al cerrar.

| Regla | Detecta | Parámetros | Acción por defecto |
|---|---|---|---|
| `duplicate` | Misma factura en toda la compañía (CUFE, NIT + número, proveedor + fecha + total, o el mismo archivo). Al usuario no se le dice de quién | — | justificar |
| `blocked_concept` | Líneas con conceptos bloqueados (licor, minibar, tabaco…). Con confianza baja solo alerta | `min_confidence` | justificar |
| `outside_trip_dates` | Fecha fuera del viaje | `days_before` (0), `days_after` (1) | revisión de contabilidad |
| `missing_tax_id` | Sin NIT o con dígito de verificación inválido → tercero genérico de la compañía | — | alerta |
| `non_fiscal_document` | Recibos de caja / notas: datos mínimos, firma de quien vende y topes por recibo, mensual y anual por empleado | `required_fields`, `max_per_receipt`, `max_monthly`, `max_yearly` | justificar |
| `buyer_not_company` | Factura electrónica que no está a nombre de la compañía del anticipo (consumidor final, cédula, otra empresa) o a nombre de otra compañía del grupo. No aplica a facturas del exterior | — | revisión de contabilidad |
| `missing_fiscal_id` | Factura electrónica sin CUFE / UUID / chave en los países que lo exigen | `countries` | revisión de contabilidad |
| `excessive_tip` | Propina por encima de la sugerida; el exceso se sugiere como no reembolsable | `suggested_pct` (10) | revisión de contabilidad |
| `itemized_required` | Facturas sin detalle por encima de un valor | `above_amount` | alerta |
| `low_confidence` | La IA no está segura | `threshold` | alerta |

- **Conceptos bloqueados** por compañía (`/companies/{id}/blocked-concepts`): código, nombre,
  descripción y ejemplos. Toda compañía nueva arranca con licores, minibar, tabaco, entretenimiento
  (películas, cine) y spa.
- **Varios destinos:** `legs` en la solicitud y en `budget-preview`. El día de traslado se paga una
  vez, con la tarifa del destino de llegada; si las tarifas de los destinos están en monedas distintas,
  el presupuesto y el anticipo van en dólares.
- **Plazo de legalización:** al aprobarse, el anticipo recibe `legalization_due` (regreso +
  `legalization.deadline_months`, 1 mes por defecto); después, `overdue` es verdadero.
- **Concepto bloqueado dentro de una factura** (hotel + minibar): se sugiere como no reembolsable la
  línea más su parte proporcional de impuestos; el **aprobador decide** (`POST /expenses/{id}/review`):
  aceptar sin la línea, aceptar completo (con nota) o rechazar. Nadie revisa lo propio.
- **Justificación:** con `require_justification` el usuario debe escribirla al confirmar. Con `block`
  no puede confirmar hasta que el aprobador revise.
- **Corrección de líneas:** el usuario o el aprobador corrigen el concepto de una línea
  (`PATCH /expenses/{id}/lines/{line_id}`) y las reglas se recalculan.
- **Deducibilidad sugerida** por tipo de soporte (configurable por compañía); contabilidad puede
  cambiarla en cada gasto. Los recibos de caja quedan como "requiere documento soporte" (DIAN).
- **Legalización:** enviar (`submit`) exige que no queden gastos sin confirmar; cerrar (`close`) exige
  que el aprobador haya revisado los gastos con hallazgos.
- **Excel:** `GET /advances/{id}/legalization.xlsx` para contabilidad, mientras no exista la
  integración con Siesa.

## Inteligencia y operación (entrega 3a)

- **País y categorías por compañía:** zona horaria, razón social y tercero genérico salen del país
  (`defaults.countries`); las fechas de negocio (mes de los topes, fin del viaje) se calculan en esa
  zona. Las categorías de gasto (`/companies/{id}/categories`) son de cada compañía, con cuenta
  contable para el Excel, y la IA solo puede sugerir las activas.
- **Lectura v3:** facturas en español, inglés y portugués; hora de la compra, impuestos desglosados
  (IVA, INC, IEPS, ITBMS, otros), NIT del adquiriente y detección de "esto no es una factura" (sin
  escalar ni gastar más IA). Monedas habilitadas por configuración; el balboa se registra como dólar.
- **Tasas de cambio automáticas:** TRM oficial (datos.gov.co) y tasas del BCE (Frankfurter), todo
  cruzando por el dólar. Cada compañía elige la tasa del día de la factura o la del cierre del mes
  anterior; el usuario puede mandar su propio valor (queda como tasa manual). Un anticipo en otra
  moneda muestra el saldo también en la de la compañía.
- **Presupuestos de viaje:** zonas y tarifas por tipo de personal y categoría (por día, noche o
  viaje), cargables desde Excel con reporte por fila. Calculan el valor del anticipo; no son topes:
  pedir otro valor exige justificación y el aprobador ve ambos. Tope de efectivo en moneda
  extranjera por compañía.
- **Legalización lista para pintar:** `GET /advances/{id}` trae cada gasto con su foto (URL firmada y
  miniatura), líneas y fechas en la zona de la compañía; `GET /advances/{id}/timeline` cuenta qué
  pasó, quién y cuándo. Cancelar, anular y reabrir; entrega del dinero y liquidación de la diferencia
  (reintegro, nómina o pago); aprobadores suplentes; devolución con gastos marcados y sugerencias.
- **Deducibilidad:** la factura electrónica debe estar a nombre de la compañía del anticipo; las del
  exterior quedan para revisión de contabilidad; desglose por línea (base deducible, IVA
  descontable, INC, lo que asume el empleado) en la API y el Excel. Es una sugerencia: el criterio
  tributario lo define contabilidad.
- **Aprendizaje por correcciones:** lo que corrige un revisor se recuerda exacto en la siguiente
  factura (también lo permitido); lo del empleado espera validación del aprobador. Las líneas
  parecidas a una bloqueada solo generan alerta (`pg_trgm`). Nada se borra: se desactiva con su
  historial.
- **Tableros:** saldos por legalizar con antigüedad, gasto por concepto/país/compañía,
  cumplimiento del presupuesto, facturas a nombre de otra compañía del grupo, uso del mes y
  precisión de la IA. Todos se descargan en Excel con `?format=xlsx`.
- **Costo de la IA (solo el operador de la plataforma):** `GET /ai-costs?from=2026-05&to=2026-10`
  devuelve, por mes, modelo y compañía, las llamadas, los tokens (entrada, salida y caché) y el
  costo real en USD que reporta OpenRouter; por defecto, el mes vigente y los cinco anteriores. No
  hay tope: la lectura nunca se degrada por costo.
- **Set de evaluación:** `python -m scripts.extraction_eval /ruta/dataset [--model …]
  [--prompt-version …] [--min-accuracy 0.9]` mide la precisión por campo, el costo y el tiempo con
  facturas reales que viven fuera del repo (formato en `docs/eval_dataset_example.json`).

## Puesta en marcha local

Requisitos: Python 3.13, PostgreSQL y Redis (o Docker).

```bash
cp .env.example .env        # rellena al menos JWT_SECRET, MFA_ENCRYPTION_KEY y REDIS_URL
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head        # crea el esquema y carga la configuración inicial del sistema
python -m app.cli create-superadmin --email ops@nextbyte.com.co --name "Operación NextByte"
python -m app.cli create-admin --email admin@forsa.com --name "Admin" --company "Forsa Colombia" --country CO --currency COP
uvicorn app.main:create_app --factory --reload
```

Con Docker: `docker compose up --build` (API + PostgreSQL + Redis; las migraciones corren al
arrancar), y luego `docker compose exec api python -m app.cli create-admin ...`.

**Configuración del sistema:** modelos de IA, plantillas de WhatsApp, umbrales y valores por defecto
de negocio viven en la tabla `system_settings` (llave-valor, con tipo, rango y descripción por fila).
Solo el **superadmin** (operador de la plataforma, NextByte) los ve y los cambia con
`GET/PATCH /api/v1/settings`; el cambio aplica sin reiniciar y queda en la auditoría con el valor
anterior y el nuevo. El `.env` queda solo para secretos, infraestructura y controles de seguridad
base. El superadmin no pertenece a ninguna compañía ni ve gastos, anticipos ni datos personales de
Forsa.

R2 es obligatorio (no hay almacenamiento local): en desarrollo se usa un bucket de desarrollo. Si
faltan las credenciales de R2, WhatsApp u OpenRouter, la API arranca igual: lo que dependa de esa
integración responde **503 `service_not_configured`** y `GET /ready` muestra el estado de cada una.

## Prueba rápida con 3 facturas (sin WhatsApp)

Usa la configuración del sistema guardada en la base de datos (corre antes `alembic upgrade head`).

```bash
export OPENROUTER_API_KEY=sk-or-...
python -m scripts.try_extraction foto1.jpg foto2.jpg foto3.jpg
python -m scripts.try_extraction foto1.jpg --model google/gemini-3.5-flash-lite   # forzar un modelo
python -m scripts.try_extraction foto1.jpg --routing always_primary               # siempre 3.8 Flash
```

Por cada foto muestra: si se leyó el QR fiscal, el modelo usado, si escaló y por qué, las
verificaciones, los datos extraídos, el tiempo de cada paso y el costo en USD.

Prueba de punta a punta desde `/docs`: `POST /api/v1/auth/login` → *Authorize* → `POST
/api/v1/expenses` con la foto → `GET /api/v1/expenses/{id}` hasta que el estado sea `extracted`.

## Configuración de servicios externos

### Siesa (ERP)
El anticipo se crea en Siesa en segundo plano cuando termina su aprobación, y la legalización cuando
contabilidad la cierra y pulsa «Crear legalización en Siesa» (`POST /advances/{id}/erp/legalization`).
Cada anticipo guarda el estado (`erp_advance_status`, `erp_legalization_status`), la referencia en
Siesa y el último error; si Siesa falla, contabilidad reintenta (`POST /advances/{id}/erp/advance`).
El adaptador real aún no existe: sin él, todo queda «pendiente» con el aviso «Siesa no está configurado».

### WhatsApp (Meta Cloud API)
1. App de Meta con el producto WhatsApp y un usuario del sistema con token permanente
   (`WHATSAPP_ACCESS_TOKEN`) y el `WHATSAPP_PHONE_NUMBER_ID` del número.
2. Webhook: `https://<dominio>/webhooks/whatsapp`, token de verificación = `WHATSAPP_VERIFY_TOKEN`,
   campo `messages` suscrito. `WHATSAPP_APP_SECRET` = el App Secret (firma de los eventos).
   La cuenta de WhatsApp Business debe tener la app suscrita (sin eso se envía pero no se recibe):
   `python -m scripts.check_whatsapp <WABA_ID>` lo revisa y con `--suscribir` la suscribe.
3. Plantillas de **utilidad** (aprobadas por Meta):
   El nombre de cada plantilla se guarda en la configuración del sistema (`whatsapp.welcome_template`,
   `whatsapp.approval_template`); mientras esté vacío, ese aviso no se envía y la API responde 503.
   - **Bienvenida**: cuerpo con `{{1}}` = nombre, `{{2}}` = nombre del asistente
     (`whatsapp.assistant_name`, o "el asistente de gastos de viaje" si está vacío), aviso de privacidad
     (Ley 1581) y un botón de respuesta rápida "Sí, soy yo". Al crear un usuario con celular se le
     envía; su BSUID queda pendiente y se activa cuando confirma (evita vincular a un tercero si el
     número se digitó mal).
   - **Aprobación**: `{{1}}` solicitante, `{{2}}` valor, `{{3}}`
     viaje; botones rápidos "Aprobar" y "Rechazar".
   - **Aviso** (`whatsapp.notice_template`): `{{1}}` nombre, `{{2}}` aviso de una línea y un botón
     de respuesta rápida "Ver detalle" (obligatorio: el bot le pone su payload); por ejemplo "Hola
     {{1}}, {{2}}. Toca el botón para ver el detalle." Meta solo deja escribir libre hasta 24 h
     después del último mensaje del usuario; afuera, recordatorios y avisos usan esta plantilla y el
     mensaje completo se entrega cuando el usuario toca el botón o escribe. Si está vacía, fuera de
     la ventana no se avisa (queda en el log).

4. **WhatsApp Flows** (formularios). Los JSON versionados están en `whatsapp_flows/` (Flow JSON
   7.3; solo el de solicitar anticipo usa endpoint de datos):
   - `expense_correction.json`: corregir un gasto ([✏️ Corregir]) con los mismos campos del formulario de
     la app (tipo de documento, moneda, subtotal, impuestos, propina, descuento, medio de pago, descripción
     y firma del recibo); al guardar queda confirmado.
   - `justification.json`: justificar un gasto que la política lo pide ([✍️ Justificar]).
   - `advance_request.json`: solicitar un anticipo (➕ en el menú) en dos pantallas: el viaje y, con
     [Calcular valor], el valor ya calculado con las tarifas de viaje (se puede cambiar justificándolo).
     La segunda pantalla la arma el endpoint de datos `https://<dominio>/webhooks/whatsapp/flows`:
     1. `python -m scripts.flows_public_key --generar` y pegar la línea en `WHATSAPP_FLOWS_PRIVATE_KEY`
        (secreta; si se cifra con clave, esta va en `WHATSAPP_FLOWS_PRIVATE_KEY_PASSPHRASE`).
     2. Reiniciar la API y `python -m scripts.flows_public_key` para registrar la llave pública en el
        número de WhatsApp (se repite si cambia la llave).
     3. En el Flow, *Endpoint* → URL del endpoint, revisar la verificación de estado y publicar.
     Las peticiones van firmadas (mismo App Secret del webhook) y cifradas (RSA-OAEP + AES-GCM); el
     token del Flow dice quién pide. Sin llave el endpoint responde 503 y el Flow no se puede publicar.
   - `cash_withdrawal.json`: registrar un retiro de efectivo en otra moneda (🏧 en el menú): fecha,
     moneda, valor retirado y, si ya se saben, lo que debitó el banco y la comisión (tesorería los
     puede completar después en la app).

   En WhatsApp Manager → Flows: crear cada Flow, pegar su JSON, publicarlo y guardar su ID en
   `whatsapp.flow_expense_correction_id`, `whatsapp.flow_justification_id`,
   `whatsapp.flow_advance_request_id` y `whatsapp.flow_withdrawal_id` (`PATCH /api/v1/settings`). Sin
   ID, el botón remite a la app.
   Cada Flow se abre con un token firmado de `FLOW_TOKEN_TTL_MINUTES` (30) que identifica a quién,
   para qué y sobre qué gasto; la respuesta pasa por los mismos casos de uso que la API.

**Usuarios con username (2026):** si el usuario oculta su número, Meta envía solo el BSUID. La API lo
reconoce por BSUID; para vincularlo existen la bienvenida, el botón para compartir el número
(`request_contact_info`) y el código de la app (`POST /api/v1/me/whatsapp-link-code` → el usuario
envía `VINCULAR 123456`). Si cambia de número, el webhook `user_id_update` actualiza su BSUID.

### Cloudflare R2
Bucket **privado**. Las imágenes solo se entregan con URLs firmadas de 5 minutos, después de
verificar permisos (`GET /api/v1/expenses/{id}/file`).

### OpenRouter
Clave en `OPENROUTER_API_KEY`. Se envía `data_collection: deny` (sin entrenamiento con los datos) y
`ai.zero_data_retention=true` restringe a endpoints sin retención. No se usan modelos de origen chino.
Los modelos están en la configuración del sistema: **revisa trimestralmente las páginas de
deprecaciones de Google y Anthropic**; cambiar un modelo es configuración, no código (y se mide antes
con el set de evaluación).

| Llave | Valor inicial | Rol |
|---|---|---|
| `ai.lite_model` | `google/gemini-3.5-flash-lite` | Facturas con QR legible |
| `ai.primary_model` | `google/gemini-3.8-flash` | Fotos sin QR (POS, recibos, notas a mano) |
| `ai.fallback_model` | `google/gemini-3.8-flash` | Escalamiento (con razonamiento y alta resolución) |
| `ai.availability_fallbacks` | `anthropic/claude-haiku-5.5` | Respaldo automático si el proveedor falla |
| `ai.routing` | `by_difficulty` | `always_primary` = siempre el modelo principal |

## Seguridad

- **Auth:** access token JWT de 15 min + refresh token rotativo (si se reutiliza uno viejo se revoca
  toda la sesión). Contraseñas Argon2id, bloqueo progresivo tras 5 intentos, contraseña temporal
  obligatoria de cambiar, revocación inmediata al desactivar o cambiar la contraseña.
- **MFA (TOTP):** obligatorio para los roles de `MFA_REQUIRED_ROLES`; mientras no lo activen, la API
  responde 403 `mfa_setup_required`. Por decisión de Forsa (26/10) la lista está vacía: nadie está
  obligado, pero cualquiera puede activarlo. Para exigirlo: `admin,accountant,treasury,superadmin`.
  Login en dos pasos (`POST /auth/login` → `POST /auth/mfa`), códigos de un solo uso, semilla
  cifrada con `MFA_ENCRYPTION_KEY` y códigos de recuperación hasheados. Un admin puede reiniciar el
  MFA de otro usuario, nunca el suyo.
- **Roles:** `employee`, `approver`, `accountant`, `admin` (de Forsa) y `superadmin` (operador de la
  plataforma: solo configuración del sistema y métricas; se crea únicamente por CLI y el admin de
  Forsa no puede verlo ni asignarlo), con permisos en el código.
- **Por registro:** empleado = lo suyo; aprobador = lo suyo + su equipo; contabilidad = sus
  compañías; admin = todo. **403** si falta el permiso o la acción está prohibida (p. ej. aprobar
  lo propio); **404** si el registro no es visible (no se confirma que existe).
- **Segregación de funciones:** nadie aprueba su propio anticipo, tampoco por WhatsApp.
- **Rate limiting:** login (IP y correo), refresh, API por usuario, subidas, y por remitente de
  WhatsApp (protege el costo de la IA). Los contadores viven en Redis, así que son exactos con
  varios workers.
- **Archivos:** tipo validado por contenido (JPEG/PNG/WebP/PDF), tamaño máximo, protección contra
  imágenes gigantes.
- **IA:** la salida se trata como dato no confiable (esquema estricto + verificaciones; el prompt
  prohíbe seguir instrucciones escritas en la factura) y el usuario siempre confirma.
- **Webhook:** firma obligatoria fuera de desarrollo: sin `WHATSAPP_APP_SECRET` todo evento se
  rechaza con 403.
- **Auditoría inmutable:** `GET /api/v1/audit` con filtros (logins, MFA, cambios de usuarios,
  vinculaciones, aprobaciones, configuración). Un trigger de PostgreSQL bloquea UPDATE, DELETE y
  TRUNCATE sobre `audit_log`, y el rol de la aplicación tampoco tiene esos permisos.
- **Mínimo privilegio en BD:** la API usa `gastos_app` (sin DDL) y las migraciones `gastos_migrator`
  vía `MIGRATION_DATABASE_URL` (`scripts/db_roles.sql`).
- **Expediente de seguridad** para el cliente en `docs/security/`: arquitectura y flujos, matriz de
  controles (OWASP ASVS / ISO 27001) con enlaces a código y pruebas, subprocesadores, protección de
  datos, incidentes, continuidad y desarrollo seguro. La evidencia (bandit, pip-audit, SBOM,
  cobertura…) se regenera con `./scripts/security_evidence.sh`.

## Ambientes y despliegue (Coolify)

Paso a paso, puertos y variables: [`docs/despliegue-coolify.md`](../../docs/despliegue-coolify.md) (recurso Docker Compose con `docker-compose.prod.yml`).

El mismo repositorio se despliega dos veces en el mismo VPS:

| | Staging | Producción |
|---|---|---|
| Rama | `develop` | `main` |
| PostgreSQL | propio | propio |
| WhatsApp | app de Meta aparte con el número de prueba gratuito | número de Forsa |
| R2 | bucket `…-staging` | bucket de producción |
| OpenRouter | clave con límite de gasto bajo | clave de producción |

Checklist de cada cambio:
1. Push a `develop` → se despliega en staging → probar migraciones, WhatsApp y fotos.
2. **Respaldo de la base de producción** (backup programado de Coolify o `pg_dump`).
3. Merge a `main` → despliegue en producción (el contenedor corre `alembic upgrade head`).
4. Prueba de humo con la compañía de pruebas (`is_test=true`), que no cuenta en reportes ni uso.

Producción: `APP_ENV=production`, `ENABLE_DOCS=false` (o protegido), `CORS_ORIGINS` con el dominio del
frontend, `JWT_SECRET` aleatorio de 32+ bytes, `MFA_ENCRYPTION_KEY` (llave Fernet), roles de BD
separados (`scripts/db_roles.sql`: `DATABASE_URL` con `gastos_app`, `MIGRATION_DATABASE_URL` con
`gastos_migrator`) y respaldo diario (`scripts/backup_db.sh`, prueba de restauración con
`scripts/restore_drill.sh`).

## Tests

```bash
# PostgreSQL local con una base de pruebas (se crea el esquema en cada corrida)
export TEST_DATABASE_URL=postgresql+asyncpg://gastos:gastos@localhost:5432/gastos_test
python -m pytest -q --cov
ruff check . && ruff format --check .
mypy && lint-imports && vulture && deptry .
```

Las pruebas de seguridad (IDOR, roles, tokens, MFA, auditoría inmutable, logs sin PII) están en
`tests/security/`. La CI (`.github/workflows/ci.yml`) corre lint, tipos, arquitectura, código sin
uso, tests contra PostgreSQL con cobertura mínima del 85 %, valida las migraciones y, en el job
`security`, gitleaks, pip-audit, bandit y el SBOM.

## Endpoints principales (`/api/v1`)

El catálogo completo por rol está en `docs/USE_CASES.md` y el detalle en `/docs` (OpenAPI).

| Área | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/mfa`, `POST /auth/refresh`, `POST /auth/logout` |
| Yo | `GET /me`, `POST /me/password`, `GET /me/balances`, `POST /me/whatsapp-link-code`, `POST /me/mfa/setup\|enable` |
| Compañías | `POST/GET /companies`, `GET/PATCH /companies/{id}` |
| Usuarios (admin) | `POST/GET /employees`, `GET/PATCH /employees/{id}`, `POST /employees/{id}/deactivate\|activate\|password\|whatsapp-welcome\|whatsapp-link-code\|mfa/reset\|anonymize-contact`, `DELETE /employees/{id}/whatsapp-link`, `GET/POST/DELETE /employees/{id}/delegations` |
| Anticipos | `POST /advances/budget-preview`, `POST/GET /advances`, `GET/DELETE /advances/{id}`, `GET /advances/{id}/timeline\|return-suggestions\|legalization.xlsx`, `POST /advances/{id}/approve\|reject\|submit\|close\|return\|void\|reopen\|disburse\|settle` |
| Gastos | `POST /expenses` (multipart, `client_ref` idempotente), `GET /expenses?status=&advance_id=&updated_since=&deductibility=`, `GET/PATCH /expenses/{id}`, `GET /expenses/{id}/file`, `POST /expenses/{id}/confirm\|discard` |
| Líneas, revisión y deducibilidad | `GET /expenses/{id}/lines`, `PATCH /expenses/{id}/lines/{line_id}`, `POST /expenses/{id}/review`, `GET/POST /expenses/{id}/deductibility` |
| Configuración de la compañía | `/companies/{id}/policy-rules`, `/blocked-concepts`, `/categories`, `/travel-zones`, `/travel-rates` (+ `/import`) |
| Aprendizaje | `GET /classification-examples`, `GET /classification-examples/{id}/history`, `PATCH/DELETE /classification-examples/{id}`, `POST /classification-examples/{id}/approve\|reject` |
| Tableros | `GET /reports/pending-balances\|spend\|budget-compliance\|intercompany-invoices`, `GET /usage`, `GET /ai-costs`, `GET /companies/{id}/ai-accuracy` |
| Tasas de cambio | `GET /exchange-rates/convert`, `POST /exchange-rates/sync` (operador) |
| Auditoría | `GET /audit` |
| Configuración (superadmin) | `GET/PATCH /settings` |
| Fuera de `/api/v1` | `GET/POST /webhooks/whatsapp`, `GET /health`, `GET /ready` |

## Fuera del alcance (roadmap)

Tras la aprobación de la propuesta: topes por concepto, día o país; Excel contable con centros de
costo y proyectos; cajas menores; el adaptador real de Siesa (el flujo ya existe);
notificaciones y aprobación por correo; consulta del CUFE ante la
DIAN; SSO.

**Decisiones:** sin viáticos fijos ni kilometraje: todo se legaliza con factura, porque la factura es
lo que permite deducir en renta y descontar el IVA. **Pregunta abierta para Forsa:** si los recibos
de caja deben traer nombre e identificación de quien vende (para emitir el documento soporte), se
agregan a `required_fields` de la regla `non_fiscal_document`.
