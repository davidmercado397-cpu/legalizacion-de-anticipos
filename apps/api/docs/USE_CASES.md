# Casos de uso

Guía para el frontend: qué hace cada rol, por qué canal y con qué endpoint (todos bajo `/api/v1`,
salvo el webhook). La forma de las respuestas, errores, paginación y fechas está en
`API_CONTRACT.md`. El detalle de cada endpoint está en el OpenAPI en vivo (`/docs`).

Canales: **App** (frontend), **WA** (WhatsApp) y **Sistema** (tareas automáticas).

## Empleado (técnico)

| # | Caso | Canal | Endpoint |
|---|---|---|---|
| E1 | Iniciar sesión (y segundo factor si su rol lo exige) | App | `POST /auth/login`, `POST /auth/mfa`, `POST /auth/refresh`, `POST /auth/logout` |
| E2 | Cambiar la contraseña temporal | App | `POST /me/password` |
| E3 | Vincular su WhatsApp con código | App + WA | `POST /me/whatsapp-link-code`; por WA: `VINCULAR 123456` |
| E4 | Ver el presupuesto sugerido de un viaje (uno o varios destinos) | App | `POST /advances/budget-preview` |
| E5 | Solicitar un anticipo (valor calculado o propio con justificación; varios destinos solo en la App) | App / WA (Flow) | `POST /advances` |
| E6 | Cancelar una solicitud aún sin aprobar | App | `DELETE /advances/{id}` |
| E7 | Ver sus anticipos y el saldo (también en pesos si es en otra moneda) | App / WA (menú o "saldo") | `GET /advances`, `GET /me/balances` |
| E8 | Registrar una factura con foto o PDF (solo con un anticipo aprobado; sin él no se guarda ni se lee) | App / WA (foto) | `POST /expenses` (multipart); por WA: enviar la foto |
| E9 | Ver el estado de lectura de sus facturas | App | `GET /expenses?updated_since=…` |
| E10 | Corregir lo que leyó la IA (datos, impuestos, categoría; por WA: proveedor, NIT, número, fecha, total y categoría) | App / WA (Flow) | `PATCH /expenses/{id}` |
| E11 | Corregir el concepto de una línea | App | `GET /expenses/{id}/lines`, `PATCH /expenses/{id}/lines/{line_id}` |
| E12 | Confirmar un gasto (con justificación si la política la pide; firma del recibo de caja; tasa automática o valor propio si es otra moneda) | App / WA (botón; justificación con Flow) | `POST /expenses/{id}/confirm` |
| E13 | Descartar un gasto | App / WA (🧾 Mis gastos) | `POST /expenses/{id}/discard` |
| E14 | Ver la foto original | App | `GET /expenses/{id}/file` (redirige a URL firmada) o `file.url` del gasto |
| E15 | Ver el detalle de su legalización con fotos, líneas y fechas | App | `GET /advances/{id}` |
| E16 | Ver la línea de tiempo del anticipo | App | `GET /advances/{id}/timeline` |
| E17 | Enviar la legalización a revisión | App / WA (menú o recordatorio) | `POST /advances/{id}/submit` |
| E18 | Atender una devolución: ver los gastos marcados y corregirlos o justificarlos | App / WA (🧾 Mis gastos) | `GET /advances/{id}` (`return_note`), luego E10–E13 |

## Aprobador

| # | Caso | Canal | Endpoint |
|---|---|---|---|
| A1 | Aprobar o rechazar el paso que le toca de la ruta: jefe inmediato o, si escala, jefe directivo, que puede aprobar sin esperar (también como suplente) | App / WA (plantilla o ✅ Por aprobar) | `GET /advances/pending-approval`, `POST /advances/{id}/approve`, `POST /advances/{id}/reject` |
| A2 | Ver los anticipos y gastos de su equipo | App | `GET /advances`, `GET /expenses` |
| A3 | Validar o rechazar lo que corrigió su equipo | App | `GET /classification-examples?status=pending`, `POST /classification-examples/{id}/approve\|reject` |

El jefe solo aprueba la solicitud; la legalización la revisa y la cierra contabilidad (decisión 8).

## Gerencia

| # | Caso | Canal | Endpoint |
|---|---|---|---|
| G1 | Aprobar los viajes de quien no tiene jefe (directivos) y lo que escala cuando falta el jefe directivo | App / WA | `GET /advances/pending-approval`, `POST /advances/{id}/approve`, `POST /advances/{id}/reject` |

## Contabilidad

| # | Caso | Canal | Endpoint |
|---|---|---|---|
| C0a | Revisar un gasto con hallazgos (aceptar sin lo bloqueado, completo con nota, o rechazar) | App | `POST /expenses/{id}/review` |
| C0b | Corregir el concepto de una línea (enseña al sistema) | App | `PATCH /expenses/{id}/lines/{line_id}` |
| C0c | Ver sugerencias de marcas y devolver la legalización marcando gastos | App | `GET /advances/{id}/return-suggestions`, `POST /advances/{id}/return` |
| C0d | Aprobar la legalización (cerrar) y descargar su Excel | App | `POST /advances/{id}/close`, `GET /advances/{id}/legalization.xlsx` |
| C1 | Configurar reglas de política, conceptos bloqueados y categorías | App | `/companies/{id}/policy-rules`, `/blocked-concepts`, `/categories` |
| C1b | Configurar cuándo una solicitud escala al jefe directivo (tolerancia sobre el presupuesto y monto total) | App | `GET/PUT /companies/{id}/approval-rules` |
| C2 | Cargar zonas y tarifas de viaje (también desde Excel) | App | `/companies/{id}/travel-zones`, `/travel-rates`, `POST /travel-rates/import` |
| C0e | Crear la legalización cerrada en Siesa, o reintentar el anticipo si Siesa falló | App | `POST /advances/{id}/erp/legalization`, `POST /advances/{id}/erp/advance` |
| C0f | Conciliar con el extracto: confirmar o deshacer cruces, cruzar a mano y decidir los cargos sin factura (antes de cerrar) | App | `GET /advances/{id}/statements`, `POST /statements/{id}/movements/{id}/confirm\|reject\|link\|decision` |
| C5 | Anular un anticipo o reabrir una legalización cerrada | App | `POST /advances/{id}/void`, `POST /advances/{id}/reopen` |
| C6 | Revisar la deducibilidad (desglose por línea, pendientes de revisión, cambiarla) | App (Contabilidad → Deducibilidad y cada gasto) | `GET /expenses/{id}/deductibility`, `GET /expenses?deductibility=requires_review`, `POST /expenses/{id}/deductibility` |
| C7 | Nombrar aprobadores suplentes | App | `GET/POST /employees/{id}/delegations`, `DELETE …/delegations/{id}` |
| C8 | Gestionar lo aprendido (corregir, compartir con el grupo, desactivar) | App (Contabilidad → Aprendizaje) | `/classification-examples` |
| C9 | Tableros y Excel: saldos por legalizar, gasto, presupuesto, facturas a otra compañía | App (Contabilidad → Reportes) | `/reports/*?format=xlsx` |
| C10 | Precisión de la IA (también cuántos documentos se corrigieron antes de confirmar) y uso del mes | App | `GET /companies/{id}/ai-accuracy`, `GET /usage` |
| C11 | Consultar la tasa de cambio de una fecha | App | `GET /exchange-rates/convert` |

## Tesorería

| # | Caso | Canal | Endpoint |
|---|---|---|---|
| T1 | Registrar la entrega del anticipo y ver los pendientes de entregar | App | `POST /advances/{id}/disburse`, `GET /advances?status=approved&disbursed=false` |
| T1b | Cargar el extracto de la tarjeta (CSV, Excel con vista previa de columnas, o PDF leído con IA) con la legalización enviada | App | `POST /advances/{id}/statements/preview`, `POST /advances/{id}/statements` |
| T2 | Registrar el reintegro del empleado o el reembolso de la empresa | App | `POST /advances/{id}/settle`, `GET /advances?settlement=pending` |

## Administrador de Forsa

| # | Caso | Canal | Endpoint |
|---|---|---|---|
| D1 | Crear y editar compañías (país, moneda, razón social, NIT, zona horaria, tope de efectivo, política de tasa) | App | `/companies` |
| D2 | Crear, editar, desactivar usuarios; contraseña temporal; reiniciar el MFA de otro | App | `/employees`, `…/deactivate`, `…/password`, `…/mfa/reset` |
| D3 | Gestionar la vinculación de WhatsApp (bienvenida, código, desvincular) | App | `…/whatsapp-welcome`, `…/whatsapp-link-code`, `DELETE …/whatsapp-link` |
| D4 | Borrar el contacto de un usuario retirado (habeas data) y consultar la auditoría | App | `POST /employees/{id}/anonymize-contact`, `GET /audit` |

## Operador de la plataforma (NextByte, superadmin)

| # | Caso | Canal | Endpoint |
|---|---|---|---|
| O1 | Cambiar parámetros del sistema (modelos de IA, plantillas, umbrales, valores por defecto) | App | `GET/PATCH /settings` |
| O2 | Forzar la descarga de tasas de cambio | App | `POST /exchange-rates/sync` |
| O3 | Ver el uso del mes y el costo de la IA por mes, modelo y compañía, con tokens (sin acceso a gastos ni datos personales de Forsa) | App | `GET /usage`, `GET /ai-costs` |

## Sistema

| # | Caso | Disparador |
|---|---|---|
| S1 | Recibir mensajes y fotos de WhatsApp (firma, idempotencia) | `POST /webhooks/whatsapp` |
| S2 | Identificar al remitente (BSUID o teléfono) o pedirle que se vincule | Webhook |
| S3 | Leer la factura: QR fiscal, IA con ruteo y escalamiento, verificaciones, varias facturas por foto | Al recibir el archivo |
| S4 | Pedir otra foto si es borrosa o si no es una factura | Lectura |
| S5 | Aplicar lo aprendido y las políticas de la compañía | Lectura |
| S6 | Asignar el anticipo (el único abierto o el que cubre la fecha) y convertir la moneda | Lectura |
| S7 | Avisar por WhatsApp con un mensaje por factura y botones [Está bien] [Corregir]; descartar sola la factura que el empleado ya había enviado | Lectura |
| S8 | Reintentar lecturas fallidas o atascadas | Tarea periódica |
| S9 | Descargar las tasas de cambio (TRM y BCE) | Tarea periódica |
| S11 | Avisar al aprobador que tiene un anticipo por aprobar | Al solicitar |
| S12 | Activar lo aprendido de un empleado al cerrarse su legalización | Al cerrar |
| S13 | Recordar la legalización días después del viaje (plantilla fuera de la ventana de 24 h) | Tarea periódica |
| S14 | Cerrar la conversación de WhatsApp por inactividad, con un solo recordatorio si quedó algo pendiente | Tarea periódica |
| S15 | Avisar al empleado cada cambio de su anticipo (fuera de la ventana, el detalle se entrega cuando toca [Ver detalle] o escribe) | Al cambiar de estado |
| S16 | Crear el anticipo en Siesa (si falla, queda el error para reintentar) | Al aprobarse |
