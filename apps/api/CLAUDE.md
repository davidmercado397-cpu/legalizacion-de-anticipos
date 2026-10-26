# CLAUDE.md — API de anticipos y gastos de viaje (Forsa)

Guía para una IA (o dev) que retoma este repo sin contexto previo. Léela entera antes de tocar código.

## Qué es este servicio

API para **solicitar, aprobar y legalizar anticipos
de gastos de viaje** del grupo Forsa (Colombia, Panamá y México), tipo Rindegastos. Los gastos se
capturan con una **foto de la factura** por **WhatsApp** (Meta Cloud API, conexión directa) o por la
app; la imagen se archiva en **Cloudflare R2** y la lee una **IA de visión vía OpenRouter**, con una
capa determinística primero (QR fiscal DIAN/SAT/DGI, texto de PDF, verificaciones).

- **Un solo cliente (Forsa), no multitenant**, pero **multiempresa** dentro del grupo (`companies`).
- Vive en `apps/api` del monorepo; la web (React) está en `apps/web` y consume el contrato OpenAPI.
  Las reglas confirmadas por el negocio (`docs/decisiones-confirmadas.md` en la raíz) mandan sobre
  cualquier comportamiento anterior de esta API.
- Base de la propuesta comercial NBT-2026-P4. Lo que está fuera del MVP se lista en "Pendiente".

## Estado actual

- Incremento 1 (núcleo) y 2 (políticas, líneas, revisión, Excel) entregados.
- Limpieza de código zombie, R2 obligatorio y herramientas de calidad en CI.
- Contrato de API (errores con código + mensaje en español, listados paginados, `X-Request-ID`).
- Configuración del sistema llave-valor (`system_settings`, migración 0003) administrada por el rol
  `superadmin`; Redis para límites de peticiones y caché compartida entre workers.
- Seguridad: MFA TOTP obligatorio para `MFA_REQUIRED_ROLES` (login en dos pasos, semilla cifrada
  con `MFA_ENCRYPTION_KEY`), auditoría inmutable (trigger + permisos, migración 0004), roles de BD
  separados (`gastos_app` sin DDL, `gastos_migrator` vía `MIGRATION_DATABASE_URL`), respaldos con
  prueba de restauración y expediente de seguridad para el cliente en `docs/security/`.
- 3a entregada: país por compañía (zona horaria, razón social, tercero genérico desde
  `defaults.countries`), categorías configurables por compañía (`expense_categories`), extracción
  v3 multilingüe (hora, impuestos desglosados, adquiriente, "no es factura") y monedas soportadas
  (`operation.supported_currencies`). Migración 0005.
- Tasas de cambio (migración 0006): TRM oficial (datos.gov.co) y BCE (Frankfurter) se descargan
  cada `EXCHANGE_RATES_SYNC_SECONDS`; todo cruza por el dólar (`domain/exchange.py`). El gasto en
  otra moneda trae su tasa automática según `companies.exchange_rate_policy`; el usuario puede
  mandar su valor (tasa `manual`). Anticipos en otra moneda muestran el saldo también en la de la
  compañía. Las tareas periódicas (`PeriodicJobs`) usan un candado en Redis por ronda.
- Presupuestos de viaje (migración 0007): zonas (`travel_zones`, lugares que resuelven el destino)
  y tarifas zona x tipo de personal x categoría (`travel_budget_rates`, carga por Excel todo o
  nada con reporte por fila). Solo calculan el valor del anticipo (`domain/budgets.py`), no son
  topes: pedir otro valor exige justificación. Tope de efectivo en moneda extranjera por compañía.
- Legalización (migración 0008): detalle con foto (URL firmada + miniatura), líneas y fechas en la
  zona de la compañía (`schemas.localize`, único lugar de conversión), línea de tiempo desde la
  auditoría, cancelar/anular/reabrir, entrega y liquidación de la diferencia (`TreasuryService`,
  permiso `advances:administer`), aprobadores suplentes (`approver_delegations`; `AccessPolicy`
  resuelve la suplencia vigente), devolución con gastos marcados y supresión de contacto de retirados.
- Deducibilidad (migración 0009): regla `buyer_not_company` (la factura electrónica a nombre de la
  compañía; genéricos por país en `fiscal.generic_buyer_ids`; a nombre de otra compañía del grupo
  alerta aparte), facturas del exterior a `requires_review`, datos mínimos de recibos
  (`required_fields`) y desglose por línea (`domain/deductibility.py`) en la API y el Excel. Si
  contabilidad fija la deducibilidad a mano, la reevaluación no la pisa. Solo es una sugerencia: el
  criterio tributario lo define contabilidad de Forsa.
- Tableros (migración 0010): `ReportRepository` en `persistence/reports.py` con SQLAlchemy Core
  (saldos por legalizar con antigüedad, gasto por categoría/país/compañía, cumplimiento del
  presupuesto, facturas a nombre de otra compañía del grupo, uso y precisión de la IA), todos con
  `?format=xlsx`.
- Costo de la IA (migración 0012, reemplaza el presupuesto): `GET /ai-costs` solo para el superadmin
  (`platform_costs:read`), por mes, modelo y compañía, con tokens y USD. Sin tope: la lectura nunca
  se degrada por costo.
- Aprendizaje (migración 0011, `pg_trgm`): `LearningService` se llama directo desde los casos de uso,
  en la misma transacción. Lo que corrige un revisor queda activo; lo del empleado, pendiente hasta
  que lo valide su aprobador (categorías por NIT: al cerrar la legalización). Al leer: memoria exacta
  (texto normalizado / NIT; la compañía gana al grupo) y alerta por parecido (nunca etiqueta solo);
  correcciones recientes van como ejemplos al prompt. No es retroactivo: solo recalcula lo no
  confirmado. Nunca se borra: se desactiva, con historial.
- Set de evaluación: `python -m scripts.extraction_eval` (dataset fuera del repo; formato en
  `docs/eval_dataset_example.json`). mypy también revisa `scripts/`.
- Diagnóstico de la IA: `python -m scripts.check_ai` (clave, créditos, modelos de la configuración y una
  lectura mínima con las restricciones de proveedor reales). El error de OpenRouter lleva su motivo al log.
- Diagnóstico de R2: `python -m scripts.check_storage`. Un fallo de R2 es `storage_unavailable` (502) con el
  código y mensaje del proveedor en el log, no un 500.
- Descuentos (migración 0021, extracción v4): `expenses.discount_amount` en positivo y ya restado del total. Un
  descuento no es una línea: el prompt v4 lo pide aparte y `_document` saca las líneas negativas que deje el
  modelo. La verificación acepta el subtotal antes o después del descuento y resta el descuento a la suma de
  líneas. El paso a v4 no se midió con el set de evaluación (no estaba disponible): medirlo antes de producción.
- Moneda de la compañía y retiros (migración 0023, decisiones 9.x): un anticipo calculado en otra moneda (la del
  destino) se entrega y se legaliza en la de la compañía (`advances.settlement_*`; `Advance.ledger_currency` /
  `ledger_amount` mandan en el saldo, las conversiones de facturas, la conciliación, el Excel, WhatsApp y Siesa).
  Estimado con la tasa del día al pedirlo; al desembolsar tesorería fija lo entregado. Retiros en el exterior
  (`cash_withdrawals`, `application/withdrawals.py`): bolsas con la tasa oficial del día o la debitada; las facturas en
  efectivo las gastan FIFO (`domain/withdrawals.py`, se recalcula todo el anticipo en cada cambio y se guarda en
  `expenses.cash_allocations`); lo no cubierto va con la tasa del día y la regla `cash_without_withdrawal` lo manda a
  revisión. La comisión es un gasto `withdrawal_fee` que se maneja desde el retiro. Por WhatsApp, 🏧 en el menú abre
  el Flow `cash_withdrawal.json` (migración 0024, `whatsapp.flow_withdrawal_id`; sin ID remite a la app).
- 3b, primera parte (migración 0013): sesión de WhatsApp (`whatsapp_sessions`: ventana de 24 h de
  Meta y conversación nueva tras `whatsapp.session_ttl_minutes`), presentador puro
  (`whatsapp_presenter.py`, con los límites de Meta y el formato de moneda de
  `defaults.countries[X].number_format`), un mensaje por factura con [Está bien] [Corregir] (nada se
  confirma solo), duplicado propio (misma foto antes de la IA, mismo CUFE después; queda
  `discarded` con `duplicate_of_id`), anticipo por la fecha de la factura y recordatorio de legalizar
  (`LegalizationReminders`). Los avisos que inicia el sistema van por `WhatsAppNotifier`: texto
  libre dentro de la ventana y plantilla `whatsapp.notice_template` afuera, con el botón [Ver detalle].
- Avisos guardados (migración 0022): lo que sale por plantilla guarda el mensaje completo en
  `whatsapp_held_notices`; `WhatsAppBot.handle` lo entrega (`WhatsAppSessions.deliver_held`) al siguiente
  mensaje del empleado antes de los handlers. Si era el botón [Ver detalle] (payload `menu:menu`), ahí
  termina; si ya no hay nada, el menú lo atiende. Vence a los `whatsapp.notice_hold_days` y
  `close_idle` borra los vencidos.
- Sin anticipo no hay facturas: `ExpenseService` (app y WhatsApp) exige un anticipo aprobado y abierto para
  registrar una factura (`no_open_advance`, 409; no se guarda ni se lee con IA) y para confirmarla
  (`advance_required`). El bot responde con [➕ Solicitar anticipo] y ya no ofrece «Sin anticipo».
  Con varios anticipos abiertos y una factura que no se asigna sola por la fecha, el bot nunca se queda en el
  error: [Está bien], [Justificar] o un Flow que choca con `advance_required` mandan la lista de anticipos
  (`pick:<gasto>:<anticipo>`, que asigna y sigue con la confirmación o abre la justificación). No se interpreta texto
  libre: si escribe mientras una factura espera su anticipo, `MenuHandler` le vuelve a mostrar la lista. Las listas
  solo traen anticipos abiertos ya en curso (`choosable`: sin los viajes que no han empezado); si no queda ninguno, el bot
  dice que no hay un anticipo en curso (`NO_ADVANCE_IN_PROGRESS`).
  La asignación automática (`ExpenseProcessor._auto_assign`) usa el mismo criterio: un viaje que no ha empezado nunca
  recibe una factura solo, aunque sea el único anticipo abierto.
- 3b, menú (`whatsapp_menu.py`, `MenuHandler`): saludo al empezar la conversación, palabras clave
  (`whatsapp.keywords`), despedida que cierra la sesión, opciones por rol (Mis anticipos, Saldo,
  Pendientes, Mis gastos, Enviar legalización, Por aprobar con `AdvanceService.decision_queue`) y
  cierre por inactividad con un solo recordatorio (`WhatsAppSessions.close_idle`).
- 3b, WhatsApp Flows (migración 0014, `whatsapp_flows.py`): corregir, justificar y solicitar anticipo
  con los JSON de `whatsapp_flows/` (respuesta final por `nfm_reply`). El token del Flow
  (JWT `typ=flow`, `FLOW_TOKEN_TTL_MINUTES`) dice quién, para qué y sobre qué registro; responde solo
  si coincide con el remitente. Sin el ID del Flow configurado, el bot remite a la app. El de corregir tiene los
  campos del formulario web (moneda en lista, de `operation.supported_currencies`, que `/me` también expone).
  El de solicitar anticipo es el único con endpoint de datos (`POST /webhooks/whatsapp/flows`, `FlowDataExchange`):
  la pantalla del viaje hace `data_exchange` y el endpoint abre AMOUNT con el valor de `TravelBudgetService.preview`.
  Cifrado en `adapters/inbound/whatsapp/flow_crypto.py` (`WHATSAPP_FLOWS_PRIVATE_KEY`, la pública se registra con
  `python -m scripts.flows_public_key`); 421 si no descifra, 427 si el token no sirve (control W7).
- 3b, avisos de estado: `AdvanceService` y `TreasuryService` emiten `AdvanceEvents` después del commit
  (Observer mínimo); `StatusNotices` avisa al empleado (aprobado con razón social y NIT, rechazado,
  anulado, entregado, devuelto con marcas, cerrado con el resultado) y al aprobador (enviada o
  reenviada). La métrica `corrected_before_confirm` va en `/ai-accuracy`.
- Monorepo: el contrato para la web se exporta con `python -m scripts.export_openapi` a
  `packages/contracts/openapi.json` (el CI exige que esté al día; luego `pnpm --filter
  @viaticos/contracts generar`). `/me` dice si falta activar el MFA, `GET /advances` trae el nombre
  de quien pidió cada anticipo y cada hallazgo de política trae su `message` (el mismo texto del bot).
  Sin IA configurada, la factura subida por la app queda de una vez para completar a mano.
  `R2_PUBLIC_ENDPOINT_URL` firma las URLs con la dirección del navegador (SeaweedFS en Docker local);
  datos de desarrollo con `python -m scripts.seed_dev`.
- Roles por paso (decisiones 4 y 8): el jefe aprueba la solicitud, contabilidad revisa y cierra la
  legalización, tesorería (`treasury`) desembolsa y liquida, gerencia (`management`) aprueba a los
  directivos. Ruta de aprobación por niveles (migración 0015, `domain/approvals.py`): cada solicitud
  guarda sus pasos; escala al jefe directivo (el jefe del jefe) si supera el presupuesto más la
  tolerancia o el monto de `companies.approval_*` (lo configura contabilidad); el nivel superior aprueba
  sin esperar; sin jefe, gerencia. Las solicitudes anteriores (sin pasos) conservan la regla anterior.
- Reglas confirmadas (migración 0016): acción `review` (no frena al viajero; la decide contabilidad al
  cerrar), fechas con `days_before`/`days_after` (0 y 1; `tolerance_days` sigue como respaldo, también para
  elegir el anticipo por fecha), `missing_fiscal_id` (factura electrónica sin CUFE/UUID en `countries`),
  `excessive_tip` (propina sobre `suggested_pct` del consumo; el exceso suma a lo no reembolsable),
  `receipt_not_signed` dentro de `non_fiscal_document` (`expenses.receipt_signed`, se declara al confirmar),
  plazo de legalización (`advances.legalization_due` = regreso + `legalization.deadline_months`, al aprobarse;
  `overdue` se calcula en la respuesta) y conceptos excluidos nuevos (entretenimiento, spa, más licores).
- Varios destinos (migración 0017): `advances.legs` guarda los tramos y destination/fechas resumen el
  viaje. `domain/budgets.calculate_legs`: el día de traslado lo paga el tramo de llegada, cada tramo usa
  la zona de su destino (una zona puede ser un país) y si las tarifas se mezclan en monedas el
  anticipo va en USD con la tasa del día del cálculo. Las tarifas siguen siendo zona × tipo de personal.
- Conciliación bancaria (migración 0019, `domain/reconciliation.py`, `application/reconciliation.py`):
  tesorería carga el extracto de la tarjeta (CSV/Excel con perfil de columnas sugerido, o PDF que lee la
  IA y suma al costo de la IA) con la legalización enviada; el cruce pondera valor, fecha y comercio
  (`reconciliation.match`). Un cruce confirmado legaliza el valor del banco (7.8); un cargo del viaje sin
  factura lo decide contabilidad (lo asume la empresa o se descuenta, 7.6); una factura con tarjeta sin
  cargo queda en alerta (7.7). Cerrar exige que no quede nada por decidir.
- Calidad primero en la IA (migración 0025): `ai.routing = always_primary` (todo con `gemini-3.8-flash`),
  alterno `anthropic/claude-opus-5.5` y aviso de demora a los 20 s, solo donde seguía el valor anterior. Un
  modelo que OpenRouter no ofrece ya no se deja guardar (`unknown_ai_model`, puerto `ModelCatalog`,
  `OpenRouterModelCatalog` con la lista pública; si no responde, se guarda y queda en el log).
- Monedas, entrega y viáticos de Forsa (migración 0026, decisiones 9.7 a 9.9): `companies.currencies` dice en
  qué monedas trabaja la compañía (la local siempre, primero; por defecto solo esa). Un anticipo en una de esas
  monedas se entrega y se legaliza en ella; en otra, en la local (`settlement_*`). La entrega va en
  `advances.disbursement_parts` (tarjeta, efectivo, transferencia; suman `ledger_amount`, y con
  `settlement_currency` su total es lo entregado); el efectivo en moneda extranjera pasa por
  `ExchangeRateService.check_cash_cap`, el mismo tope de la solicitud. Unidad `per_15_days` (internet, por
  tramo), categoría `internet` y `meals` = "Alimentación y refrescos". La tabla de Forsa está en
  `docs/tarifas/` (raíz) y `test_the_forsa_rate_table_loads_as_delivered` la carga tal cual.
- **Pendiente:** el adaptador real de Siesa. Preguntas abiertas a Forsa: el tercero genérico de Panamá
  (`fiscal.generic_buyer_ids.PA` está vacío) y si los recibos de caja deben traer nombre e
  identificación de quien vende (`required_fields`). Plantillas que Forsa aprueba en Meta:
  bienvenida (`{{1}}` nombre, `{{2}}` asistente), aprobación y aviso (con el botón «Ver detalle»).
- **Stubs intencionales (no son bugs ni código zombie):** `ErpGateway` (Siesa, `domain/erp.py` y
  `application/erp.py`, migración 0018) no tiene adaptador real: el container usa
  `UnconfiguredService("siesa")`, así que el anticipo queda «pendiente» con el aviso «Siesa no está
  configurado» y contabilidad puede reintentar. Para el adaptador falta de Siesa: la API y sus
  credenciales, el documento (cédula) del empleado como tercero y qué cuenta usa cada categoría
  (`categories.accounting_account` ya existe).

## Arquitectura y decisiones (respétalas)

- **Hexagonal** (`domain` ← `application` ← `adapters`; composition root en `app/container.py`).
  Lo verifica `import-linter` en CI: el dominio no importa frameworks y la aplicación no importa
  adaptadores. Si CI falla por esto, se corrige el diseño, no el contrato.
- **SOLID + KISS, KISS manda. Clean code no estricto:** nada de sobreingeniería ni YAGNI.
  - Patrones **permitidos**: Ports & Adapters con `typing.Protocol`, Strategy + registro (reglas de
    política, enrutamiento de modelos), Repository + Unit of Work (un caso de uso guarda varias
    tablas en una transacción), Chain of Responsibility (handlers del bot), Observer mínimo
    (callbacks tras el commit), Null Object/Decorator solo si ya existen.
  - **Prohibidos**: CQRS, event sourcing, mediator, contenedor DI propio, capas "por si acaso".
- **YAGNI con proveedores:** un proveedor detrás de un Protocol; maquinaria multi-proveedor solo
  cuando exista un segundo real. Comprometidos con Meta: el puerto de WhatsApp existe para pruebas.
- **Una sola fuente de verdad para la lógica de negocio:** vive en los casos de uso
  (`app/application`). WhatsApp y la API llaman al mismo servicio; una regla implementada solo en un
  canal es un bug.
- **Open/Closed por registro:** agregar una regla, un handler o un tipo de evento = una clase nueva
  en su registro, sin tocar el despachador.
- **Nada de valores quemados:** lo de negocio por compañía va en sus tablas; lo del sistema (modelos,
  plantillas, umbrales, valores por defecto) en `system_settings`, cuyas filas traen tipo, rango y
  descripción. Los valores iniciales se cargan en una migración y desde ahí solo cambian por API
  (superadmin). El código conoce los nombres de las llaves (`RuntimeSettings`), nunca sus valores;
  agregar una llave = una migración que la inserta. El `.env` es solo para secretos,
  infraestructura y controles de seguridad base. Tras escribir configuración, invalidar la caché.
- **Integración no configurada = error claro, nunca degradación silenciosa:** si faltan R2, WhatsApp
  u OpenRouter, la app arranca, lo que dependa responde **503 `service_not_configured`** y `/ready`
  lo muestra. Solo `DATABASE_URL`, `JWT_SECRET`, `MFA_ENCRYPTION_KEY` y `REDIS_URL` impiden arrancar.
  **No hay almacenamiento local.**
- **Los efectos secundarios son falla-segura:** reacciones, "escribiendo…", avisos y registro de uso
  de IA nunca rompen el flujo principal (se registran en el log y se sigue).
- **Webhook:** body crudo, firma HMAC `X-Hub-Signature-256` (obligatoria fuera de desarrollo), 200
  inmediato, proceso en background e idempotencia por `wa_message_id`.
- **Seguridad:** 403 si el rol no tiene el permiso o la acción está prohibida sobre algo que sí ve;
  **404 si el registro está fuera de su visibilidad** (nunca se confirma que existe); 409 estado
  inválido. Segregación de funciones (nadie aprueba lo suyo). Nunca loguear tokens, secretos ni PII.
  `audit_log` es solo inserción (no se agregan rutas para editarla). Un control de seguridad nuevo
  lleva su prueba en `tests/security/` y su fila en `docs/security/02_MATRIZ_DE_CONTROLES.md`.
- **IA:** la IA solo extrae hechos; las políticas las aplica código determinístico. Todo cambio de
  prompt o modelo se mide con el set de evaluación antes y después. Sin modelos de origen chino.
- **PostgreSQL es la cola** de reintentos (transaccional con el gasto, `SKIP LOCKED`). **Redis** es
  obligatorio para límites de peticiones y caché compartida (`SharedCache`: versión por espacio de
  nombres; si Redis cae, se lee de la BD en vez de servir datos viejos). No se usa como cola.

## Convenciones de código

- **Identificadores, nombres de tests y mensajes de commit en inglés.**
- **Comentarios y docstrings en español y solo los necesarios:** el porqué de lo no obvio. Si un
  comentario repite lo que el código ya dice, sobra.
- Cada error de negocio lleva un `code` estable; su texto está en `ERROR_MESSAGES` de `messages.py` (un test
  exige que todo código tenga mensaje). Las respuestas de error y los listados siguen `docs/API_CONTRACT.md`.
- Textos que lee el usuario final (bot y errores) en `app/application/messages.py`, en español claro,
  tuteando, sin jerga técnica ni frases genéricas de IA ("Lo sentimos", "No dudes en"…). En el bot se
  usan emojis con significado fijo; en los errores de la API no.
- Type hints en todo (lo verifica `mypy`). `logging`, nunca `print` (única excepción: la CLI).
- Fechas en UTC en la BD; la fecha de negocio se calcula en la zona horaria de la compañía.

## Flujo de un gasto por WhatsApp

1. `POST /webhooks/whatsapp`: firma → 200 → background.
2. Parser → `InboundMessage`; identidad por BSUID o teléfono (vinculación por bienvenida).
3. Se crea el gasto (`received`), reacción ⏳, descarga del media de Meta (la misma foto ya enviada se
   descarta sin IA) y, en paralelo, archivo en R2 + lectura (QR → IA con enrutamiento por
   dificultad → verificaciones → escalamiento).
4. Duplicado propio → políticas de la compañía → anticipo (único abierto o por la fecha) → un mensaje
   por factura con [Está bien] [Corregir].
5. Fallo → reintento por el barrido (`ExpenseSweeper`) hasta `EXPENSE_MAX_ATTEMPTS`.

## Estructura

```
app/
  domain/        entidades, enums, errores, valores, permisos, políticas (Strategy), fiscal, puertos
  application/   casos de uso, bot (cadena de handlers), notificaciones, lectura, mensajes
  adapters/
    inbound/     HTTP (routers, esquemas, deps, errores) y webhook de WhatsApp (firma, parser)
    outbound/    PostgreSQL (tablas, mapeo imperativo, repos, UoW), R2, OpenRouter, Graph API,
                 documentos (Pillow, zxing), seguridad (Argon2, JWT), infraestructura
  container.py   composition root          main.py  app FastAPI + lifespan
prompts/         prompts versionados de la IA
whatsapp_flows/  Flow JSON de los formularios de WhatsApp (se publican en WhatsApp Manager)
alembic/         migraciones (PostgreSQL)
tests/           unit/, integration/ y security/ (PostgreSQL real; IA, WhatsApp y R2 simulados en tests/fakes.py)
scripts/         CLI de apoyo: evidencia de seguridad, respaldo y simulacro de restauración, roles de BD
```

## Cómo trabajar aquí

```bash
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
export TEST_DATABASE_URL=postgresql+asyncpg://gastos:gastos@localhost:5432/gastos_test
.venv/bin/python -m pytest -q --cov          # tests contra PostgreSQL real (cobertura mínima 85 %)
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/mypy && .venv/bin/lint-imports && .venv/bin/vulture && .venv/bin/deptry .
alembic upgrade head                          # migraciones
```

## Al hacer cambios

- Tests verdes y tests nuevos para lo nuevo (mismo estilo: PostgreSQL real + fakes de `tests/fakes.py`
  + respx para HTTP).
- **Cada cambio de esquema lleva su migración Alembic**, verificada con `upgrade`, `downgrade` y
  `alembic check` en PostgreSQL real. En PostgreSQL manda Alembic.
- Sin código zombie: si algo deja de usarse, se borra (lo vigilan `vulture` y `deptry`).
- Endpoints nuevos: permiso con `require(...)` y visibilidad por registro con `AccessPolicy`.
- Actualiza la sección "Estado actual" de este documento en cada incremento.

## Documentación

`README.md` (visión, puesta en marcha, configuración de servicios externos, despliegue),
`docs/API_CONTRACT.md` (forma de errores, códigos HTTP, paginación, cabeceras, fechas),
`docs/USE_CASES.md` (casos de uso por rol, con canal y endpoint), `docs/security/`
(expediente para el cliente; la evidencia se regenera con `./scripts/security_evidence.sh`) y `docs/MENSAJES.md` (todos los
textos al usuario; se genera con `python -m scripts.export_messages`, no se edita a mano). OpenAPI en vivo en
`/docs`.
