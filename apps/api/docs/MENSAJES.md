# Mensajes al usuario

Generado con `python -m scripts.export_messages` desde `app/application/messages.py`. No editar a mano:
los cambios se hacen en `messages.py` y se vuelve a generar.

## WhatsApp

| Clave | Texto |
|---|---|
| `REACTION_RECEIVED` | ⏳ |
| `REACTION_OK` | ✅ |
| `REACTION_WARNING` | ⚠️ |
| `REACTION_ERROR` | ❌ |
| `NOT_REGISTERED` | Hola 👋 Este número no está registrado para legalizar gastos. Si trabajas en la compañía, pide a contabilidad que te registre, o comparte tu número con el botón de abajo para vincular tu cuenta. |
| `NOT_REGISTERED_SHORT` | Este número no está registrado. Contacta a contabilidad para que te registren. |
| `LINK_OK` | ✅ Listo {name}, tu WhatsApp quedó vinculado. {assistant}Te ayudo con tus gastos de viaje: envíame la foto de cada factura y yo la leo. |
| `DEFAULT_ASSISTANT` | el asistente de gastos de viaje |
| `LINK_FAILED` | No pude vincular tu cuenta con ese código. Verifica que sea el último código generado en la app. |
| `LINK_CONFIRM_FAILED` | No pude confirmar tu identidad. Contacta a contabilidad. |
| `RATE_LIMITED` | 😅 Vas muy rápido. Espera un minuto y sigue; lo que ya enviaste no se perdió. |
| `GREETING` | Hola {name} 👋 {assistant}¿Qué necesitas? |
| `ASSISTANT_INTRO` | Soy {assistant}.  |
| `MENU_PROMPT` | ¿En qué más te ayudo? |
| `MENU_PHOTO_HINT` | 📸 Para registrar un gasto, envíame la foto de la factura. |
| `MENU_BUTTON` | Ver opciones |
| `FAREWELL` | ¡Con gusto, {name}! Aquí estoy cuando me necesites 👋 |
| `MY_ADVANCES` | 💰 Tus anticipos: |
| `NO_ADVANCES` | Todavía no tienes anticipos. Puedes solicitar uno desde el menú. |
| `ADVANCE_ITEM` | • *{label}* · {status} · {amount} |
| `ADVANCE_RETURNED_NOTE` |    ↩️ Te la devolvieron: {note} |
| `BALANCE_ITEM` | 💰 *{label}*    Entregado: {amount}    Legalizado: {applied}    Pendiente: {pending} |
| `BALANCE_FUNCTIONAL` |    En {currency}: pendiente {pending} (tasa {rate} del {day}) |
| `PENDING_PROMPT` | 📝 Tienes {what} por confirmar. Elige uno para verlo: |
| `EXPENSES_PROMPT` | 🧾 Tus últimos gastos. Elige uno para verlo, corregirlo o descartarlo: |
| `EXPENSES_BUTTON` | Ver gastos |
| `NO_EXPENSES` | Todavía no tienes gastos en tus anticipos abiertos. Envíame la foto de una factura 📸 |
| `REQUEST_IN_APP` | ➕ Solicita el anticipo en la app: ahí ves el valor calculado con las tarifas de viaje. |
| `SUBMIT_PROMPT` | ¿Qué legalización quieres enviar? |
| `SUBMIT_SUMMARY` | 📤 *{label}* Legalizado: {applied} de {amount} en {count}. |
| `SUBMIT_QUESTION` | ¿La envío a revisión? |
| `APPROVAL_ITEM` | 👤 {name} pide {amount} para {label}. |
| `APPROVAL_JUSTIFICATION` | Pidió otro valor que el calculado ({budget}): {justification} |
| `APPROVALS_MORE` | Hay {count} más: revísalas en la app. |
| `NOTHING_TO_APPROVE` | No tienes anticipos por aprobar 👍 |
| `IDLE_REMINDER` | {name}, quedó pendiente: {what}. Cuando puedas, lo revisamos 👇 |
| `IDLE_UNREADABLE` | una foto que no pude leer (envíamela de nuevo) |
| `BUTTON_APPROVE` | ✅ Aprobar |
| `BUTTON_REJECT` | ❌ Rechazar |
| `BUTTON_SEE_PENDING` | 📝 Ver pendientes |
| `BUTTON_SEND` | 📤 Enviar |
| `SLOW_NOTICE` | Sigo revisando tu factura, te aviso en un momento ⏳ |
| `PROCESSING_FAILED` | ❌ No pude leer una de tus facturas. Puedes completarla manualmente en la app. |
| `UNREADABLE` | ❌ La foto salió borrosa o cortada. ¿Me la envías de nuevo, con buena luz y completa? |
| `NOT_A_RECEIPT` | 🤔 Esto no parece una factura ni un recibo. ¿Me envías la foto del comprobante? 📸 |
| `NO_OPEN_ADVANCES` | No tienes anticipos abiertos en este momento. |
| `NO_PENDING` | No tienes gastos pendientes por confirmar. 👍 |
| `CONFIRMED_ONE` | ✅ Gasto confirmado. |
| `CONFIRM_QUESTION` | ¿Está bien? |
| `CONFIRMED_BALANCE` | 📌 En {label} te quedan {pending} por legalizar. |
| `DISCARDED` | 🗑️ Gasto descartado. |
| `ASSIGN_PROMPT` | ¿A qué anticipo asigno {what}? |
| `ASSIGN_BUTTON` | Elegir anticipo |
| `NO_ADVANCE_FOR_EXPENSES` | 📭 Todavía no tienes un anticipo aprobado, así que no registré esta factura. Solicita uno y, cuando te lo aprueben, me envías las fotos de tus facturas. |
| `BUTTON_REQUEST_ADVANCE` | ➕ Solicitar anticipo |
| `ASSIGNED` | 📌 Asignado a: {label}. |
| `ACTION_NOT_ALLOWED` | No puedes realizar esa acción. |
| `ADVANCE_APPROVED_BY_WA` | ✅ Anticipo de {name} aprobado. |
| `ADVANCE_STEP_APPROVED_BY_WA` | ✅ Aprobaste el anticipo de {name}. Falta la aprobación de {next}. |
| `ADVANCE_REJECTED_BY_WA` | ❌ Anticipo de {name} rechazado. |
| `BUTTON_OK` | ✅ Está bien |
| `BUTTON_CORRECT` | ✏️ Corregir |
| `BUTTON_JUSTIFY` | ✍️ Justificar |
| `BUTTON_DISCARD` | 🗑️ Descartar |
| `BUTTON_CHANGE_ADVANCE` | 🔁 Cambiar anticipo |
| `BUTTON_SUBMIT` | 📤 Enviar a revisión |
| `DETAIL_TAX_ID` | NIT {tax_id} |
| `DETAIL_NUMBER` | Factura {number} |
| `DETAIL_MORE_LINES` | …y {count} más |
| `DETAIL_SUBTOTAL` | Base: {amount} |
| `DETAIL_TAX` | {label}{rate}: {amount} |
| `DETAIL_TIP` | Propina: {amount} |
| `DETAIL_DISCOUNT` | Descuento: -{amount} |
| `DETAIL_TOTAL` | *Total: {amount}* |
| `DETAIL_CONVERTED` | Equivale a {amount} (tasa {rate} del {day}) |
| `DETAIL_ADVANCE` | 📌 Anticipo {label} · saldo al confirmar: {pending} |
| `DETAIL_ADVANCE_BY_DATE` | 📌 Por la fecha lo asigné a {label} · saldo al confirmar: {pending} |
| `REVIEW_READING` | 👀 Es un recibo sin código QR: revisa que el total y la fecha estén bien leídos. |
| `DUPLICATE_OWN` | ⚠️ Esta factura ya la tengo registrada ({what}), así que no la sumé otra vez. |
| `FLOW_CORRECT_TEXT` | ✏️ Corrige lo que haga falta y guarda: el gasto queda confirmado. |
| `FLOW_CORRECT_CTA` | Corregir |
| `FLOW_JUSTIFY_TEXT` | ✍️ Cuéntame por qué este gasto es del viaje y lo confirmo. |
| `FLOW_JUSTIFY_CTA` | Justificar |
| `FLOW_REQUEST_TEXT` | ➕ Completa los datos del viaje y te muestro el valor calculado con las tarifas de viaje. |
| `FLOW_BUDGET` | 💰 Valor calculado con las tarifas de viaje: {amount}. Si pides otro valor, explica por qué. |
| `FLOW_NO_BUDGET` | No hay tarifas de viaje para este destino: escribe el valor del anticipo. |
| `FLOW_REQUEST_CTA` | Solicitar anticipo |
| `FLOW_EXPIRED` | ⌛ Ese formulario venció. Ábrelo de nuevo desde el menú. |
| `FLOW_INVALID` | No pude leer los datos del formulario. Ábrelo de nuevo y revísalos. |
| `JUSTIFY_REASON` | La política de gastos pide una justificación para este gasto. |
| `ADVANCE_REQUESTED` | 📨 Listo, pedí tu anticipo de {amount} para {label}. Te aviso cuando lo aprueben. |
| `CORRECTED_CONFIRMED` | ✏️ Listo, lo corregí y quedó confirmado. |
| `FLOW_UNSET` | Sin definir |
| `FLOW_BY_ADVANCE` | Según el anticipo |
| `CORRECT_IN_APP` | ✏️ Para corregir este gasto entra a la app: ahí puedes cambiar cualquier dato y confirmarlo. |
| `JUSTIFY_IN_APP` | ✍️ Escribe la justificación en la app y confirma el gasto desde ahí. |
| `MOVE_PROMPT` | ¿A qué anticipo paso este gasto? |
| `MOVED` | 📌 Listo, quedó en {label}. |
| `SUBMITTED` | 📤 Listo, envié tu legalización a revisión. Te aviso cuando tu aprobador la revise. |
| `NOTICE_APPROVED` | ✅ {approver} aprobó tu anticipo {label} por {amount}. |
| `NOTICE_INVOICE_TO` | 🧾 Pide tus facturas a nombre de *{legal_name}*, NIT {tax_id}. |
| `NOTICE_APPROVED_LINE` | {approver} aprobó tu anticipo {label} por {amount} |
| `NOTICE_REJECTED` | ❌ {approver} no aprobó tu anticipo {label}. |
| `NOTICE_REJECTED_LINE` | {approver} no aprobó tu anticipo {label} |
| `NOTICE_VOIDED` | 🚫 Contabilidad anuló tu anticipo {label}. |
| `NOTICE_VOIDED_LINE` | contabilidad anuló tu anticipo {label} |
| `NOTICE_NOTE` | Motivo: {note} |
| `NOTICE_RETURNED` | ↩️ {approver} te devolvió la legalización de {label} para cambios. |
| `NOTICE_RETURNED_MARKS` | Marcó {what} para revisar. |
| `NOTICE_RETURNED_LINE` | {approver} te devolvió la legalización de {label} para cambios |
| `NOTICE_CLOSED` | ✅ {approver} aprobó tu legalización de {label}. |
| `NOTICE_CLOSED_LINE` | {approver} aprobó tu legalización de {label} |
| `NOTICE_DISBURSED` | 💸 Tesorería te entregó el anticipo {label} ({amount}). |
| `NOTICE_DISBURSED_LINE` | tesorería te entregó el anticipo {label} ({amount}) |
| `BUTTON_SEE_MARKED` | ↩️ Ver marcados |
| `MARKED_PROMPT` | ↩️ Estos gastos te los marcaron para revisar. Elige uno: |
| `NO_MARKED` | No tienes gastos marcados por revisar 👍 |
| `LEGALIZATION_REMINDER` | ⏰ {name}, tu viaje a {destination} terminó el {end}. Llevas legalizado {applied} de {amount}. |
| `LEGALIZATION_REMINDER_PENDING` | Antes de enviarla, confirma o descarta {what}. |
| `LEGALIZATION_REMINDER_SUBMIT` | Cuando esté completa, envíala a revisión con el botón. |
| `LEGALIZATION_REMINDER_NOTICE` | tu viaje a {destination} terminó el {end}; recuerda enviar la legalización ({applied} de {amount}) |
| `NEEDS_JUSTIFICATION_HINT` | ✍️ Necesita una justificación antes de confirmarse |
| `BLOCKED_HINT` | ⛔ Bloqueado: lo revisará tu aprobador |
| `NEEDS_JUSTIFICATION` | ✍️ Este gasto necesita una justificación antes de confirmarse. Complétala en la app. |
| `BLOCKED_BY_POLICY` | ⛔ Este gasto está bloqueado por la política de gastos; lo revisará tu aprobador. |
| `AGING_NO_DATE` | sin fecha |
| `NO_COMPANY` | Sin compañía |
| `YES` | Sí |
| `NO` | No |
| `DEDUCTIBILITY_NOTE` | Sugerencia calculada por línea; el criterio tributario lo define contabilidad. |
| `pending_expenses(1) / (3)` | el gasto pendiente / los 3 gastos pendientes |

## Alertas de política

| Clave | Texto |
|---|---|
| `duplicate_invoice` | Esta factura ya está registrada |
| `blocked_concept` | Incluye {concepts} ({amount}), que no es reembolsable |
| `possible_blocked_concept` | Podría incluir {concepts}, revísalo |
| `owner_concept_override` | Marcaste como permitido algo que parecía {concepts}: lo revisará tu aprobador |
| `outside_trip_dates` | La fecha de la factura ({invoice_date}) está fuera de las fechas del viaje |
| `missing_tax_id` | La factura no tiene NIT. Si puedes, pide una con NIT; si no, igual queda registrada |
| `invalid_tax_id` | El NIT de la factura no parece correcto. Revísalo; si está bien así, igual queda registrada |
| `receipt_cap_exceeded` | Este recibo es de {value} y el tope para recibos sin factura es {cap} |
| `monthly_cap_exceeded` | Con este recibo llevas {value} este mes en recibos sin factura; el tope es {cap} |
| `yearly_cap_exceeded` | Con este recibo llevas {value} este año en recibos sin factura; el tope es {cap} |
| `not_itemized` | La factura no detalla los productos; para este valor se necesita la factura detallada |
| `invoice_not_to_company` | La factura no está a nombre de {legal_name}: pídela con el NIT {tax_id} para que sea deducible |
| `invoice_to_other_group_company` | La factura está a nombre de {company}, otra compañía del grupo |
| `receipt_missing_data` | Al recibo le falta: {fields}. Complétalo |
| `receipt_not_signed` | El recibo de caja debe estar firmado por quien te vendió |
| `missing_fiscal_id` | La factura electrónica no trae el CUFE (o código de validación): la revisará contabilidad |
| `excessive_tip` | La propina ({tip}) supera la sugerida ({suggested}): el exceso no es reembolsable |
| `cash_without_withdrawal` | Parte de este pago en efectivo no sale de ningún retiro registrado: va con la tasa del día y la revisa contabilidad |

## Advertencias de lectura

| Clave | Texto |
|---|---|
| `low_confidence` | no estoy seguro de haber leído bien algunos datos, revísalos 👀 |
| `verification_failed` | los valores de la factura no cuadran entre sí, revísalos |
| `qr_mismatch` | el total leído no coincide con el QR de la factura |
| `poor_legibility` | foto poco legible |
| `currency_mismatch` | moneda distinta a la del anticipo |
| `unsupported_currency` | no reconozco la moneda de la factura, revísala |

## Errores de la API y del bot (con datos de ejemplo)

| Clave | Texto |
|---|---|
| `password_too_short` | La contraseña debe tener al menos 10 caracteres. |
| `password_spaces` | La contraseña no puede empezar ni terminar con espacios. |
| `password_contains_email` | La contraseña no puede contener tu correo. |
| `wrong_current_password` | La contraseña actual no es correcta. |
| `password_change_required` | Debes cambiar tu contraseña temporal antes de continuar. |
| `domain_error` | No se pudo completar la acción. |
| `not_found` | No encontramos el anticipo. |
| `forbidden` | Tu usuario no tiene permiso para hacer esto. |
| `invalid_state` | Esta acción no se puede hacer en el estado actual. |
| `conflict` | Ese dato ya está registrado. |
| `validation_error` | Revisa los datos enviados. |
| `session_expired` | Tu sesión expiró. Vuelve a iniciar sesión. |
| `external_service_error` | Un servicio externo no respondió. Intenta de nuevo en unos minutos. |
| `internal_error` | Tuvimos un problema interno. Intenta de nuevo; si se repite, comparte este código con soporte: 7f3c9a1b. |
| `method_not_allowed` | Esa acción no está disponible en esta ruta. |
| `invalid_credentials` | El correo o la contraseña no son correctos. |
| `login_required` | Debes iniciar sesión. |
| `account_locked` | Tu cuenta quedó bloqueada por varios intentos fallidos. Intenta de nuevo en 5 minutos. |
| `rate_limited` | Hiciste demasiadas solicitudes seguidas. Espera 30 segundos e intenta de nuevo. |
| `mfa_setup_required` | Tu rol exige verificación en dos pasos. Actívala antes de continuar. |
| `invalid_mfa_code` | El código de verificación no es correcto o ya se usó. |
| `mfa_already_enabled` | La verificación en dos pasos ya está activa. |
| `mfa_setup_not_started` | Primero inicia la activación de la verificación en dos pasos. |
| `mfa_unavailable` | No pudimos validar tu verificación en dos pasos. Pide al administrador que la restablezca. |
| `mfa_self_reset` | No puedes restablecer tu propia verificación en dos pasos; pídeselo a otro administrador. |
| `own_role_change` | No puedes cambiar tu propio rol. |
| `superadmin_reserved` | Ese rol es exclusivo del operador de la plataforma y no se puede asignar. |
| `self_deactivation` | No puedes desactivar tu propio usuario. |
| `email_taken` | Ya hay un usuario con el correo ana@forsa.com. |
| `phone_taken` | Ese celular ya está registrado a otro usuario. |
| `no_company` | El usuario debe pertenecer al menos a una compañía. |
| `unknown_company` | La compañía indicada no existe. |
| `self_approver` | Un usuario no puede ser su propio aprobador. |
| `invalid_approver` | El aprobador debe ser un usuario activo con rol de aprobador, contabilidad o administrador. |
| `invalid_country` | El país debe ser un código de dos letras, por ejemplo CO, PA o MX. |
| `unsupported_currency` | No se pudo completar la acción. |
| `unknown_country` | No se pudo completar la acción. |
| `invalid_timezone` | No se pudo completar la acción. |
| `invalid_deductibility` | La regla de deducibilidad para pos_ticket no es válida. |
| `duplicate_value` | Ese dato ya está registrado en otro registro. |
| `foreign_company` | Solo puedes solicitar anticipos para las compañías en las que trabajas. |
| `amount_not_positive` | El valor debe ser mayor que cero. |
| `negative_amount` | El valor del anticipo no puede ser negativo. |
| `end_before_start` | La fecha de regreso no puede ser anterior a la de salida. |
| `erp_advance_not_approved` | El anticipo se crea en Siesa cuando termina su aprobación. |
| `erp_legalization_not_closed` | Primero cierra la legalización; después se crea en Siesa. |
| `erp_already_sent` | Esto ya está en Siesa. |
| `legs_overlap` | No se pudo completar la acción. |
| `trip_without_legs` | Agrega al menos un destino con sus fechas. |
| `budget_rate_unavailable` | No se pudo completar la acción. |
| `invalid_advance_transition` | No se puede enviar a revisión un anticipo que está en revisión. |
| `self_decision` | No puedes aprobar ni revisar tu propio anticipo. Lo debe hacer tu aprobador. |
| `not_your_approver` | No eres el aprobador de este empleado. |
| `owner_submits` | Solo el dueño del anticipo puede enviar la legalización. |
| `pending_expenses` | Antes de enviar la legalización, confirma o descarta los 3 gastos pendientes. |
| `unreviewed_findings` | Antes de cerrar, revisa los 3 gastos con alertas de política. |
| `note_required` | Escribe una nota con el motivo. |
| `advance_has_expenses` | Este anticipo ya tiene gastos aplicados, así que no se puede anular. Legalízalo y ciérralo: la diferencia queda como reintegro. |
| `advance_already_settled` | Esta legalización ya se liquidó (reintegro o pago registrado), así que no se puede reabrir. |
| `advance_already_disbursed` | La entrega de este anticipo ya está registrada. |
| `invalid_settlement` | No hay nada que liquidar de esa forma: el anticipo está sin diferencia. |
| `invalid_delegation` | La suplencia debe ser entre dos personas distintas, el suplente debe ser un aprobador activo y la fecha final debe ser posterior a la inicial. |
| `anonymize_active_user` | Solo se pueden borrar los datos de contacto de usuarios desactivados. |
| `legalization_locked` | La legalización ya fue enviada o cerrada. Para cambiar algo, pide que te la devuelvan. |
| `advance_not_open` | Ese anticipo no está abierto para recibir gastos. |
| `no_open_advance` | No tienes un anticipo aprobado. Solicita uno y, cuando te lo aprueben, registra tus facturas. |
| `advance_required` | Elige a qué anticipo va este gasto antes de confirmarlo. |
| `advance_of_other` | Ese anticipo es de otra persona. |
| `amount_required` | Indica el valor del anticipo: no hay tarifas de viaje para calcularlo. |
| `escalation_justification_required` | Esta solicitud necesita la aprobación del jefe directivo (supera el presupuesto o el monto configurado): explica por qué la necesitas. |
| `no_approver_available` | No hay quién apruebe este viaje: pide que te asignen un jefe o que creen un usuario de gerencia. |
| `invalid_approval_tolerance` | La tolerancia debe estar entre 0 % y 100 %. |
| `invalid_approval_threshold` | Cada umbral debe tener una moneda de 3 letras y un valor mayor que cero. |
| `budget_justification_required` | No se pudo completar la acción. |
| `budget_currency_mismatch` | No se pudo completar la acción. |
| `budget_rates_missing` | Las tarifas de este destino están en varias monedas. Pide a contabilidad que las revise. |
| `staff_type_missing` | Tu usuario no tiene tipo de personal (administrativo u operativo). Pídele a contabilidad que lo configure. |
| `cash_cap_exceeded` | No se pudo completar la acción. |
| `cash_cap_unverifiable` | No tenemos la tasa de cambio de hoy para verificar el tope de efectivo. Intenta más tarde. |
| `invalid_cash_cap` | El tope de efectivo debe tener un valor mayor que cero y una moneda habilitada. |
| `statement_pdf_no_preview` | Los extractos en PDF no tienen vista previa: se leen con IA al cargarlos. |
| `statement_already_loaded` | Este archivo de extracto ya fue cargado. |
| `statement_without_charges` | No encontramos cargos en el extracto. Revisa qué columna es la del valor y el formato de las fechas. |
| `statement_profile_invalid` | Indica la columna de la fecha, la de la descripción y la del valor (o las de débito y crédito). |
| `statement_unsupported_format` | El extracto debe ser CSV, Excel (.xlsx) o PDF. |
| `statement_unreadable` | No pudimos abrir el archivo del extracto. Revisa que no esté dañado o protegido con clave. |
| `invalid_card_last4` | Escribe los 4 últimos dígitos de la tarjeta. |
| `statement_legalization_not_sent` | El extracto se carga cuando el empleado ya envió la legalización a revisión. |
| `statement_legalization_closed` | La legalización ya no está en revisión: los cruces con el extracto no se pueden cambiar. |
| `movement_not_matched` | Ese movimiento no está cruzado con ningún gasto. |
| `movement_not_charge` | Solo los cargos del extracto se cruzan con gastos. |
| `movement_already_matched` | Ese cargo ya está cruzado: deshaz el cruce primero. |
| `movement_not_decidable` | Solo se decide sobre cargos del extracto que no tienen factura. |
| `expense_already_matched` | Ese gasto ya está cruzado en otro extracto. |
| `statement_rate_missing` | No se pudo completar la acción. |
| `unresolved_bank_items` | Antes de aprobar la legalización, resuelve 3 movimientos del extracto: confirma o descarta las sugerencias y decide los cargos sin factura. |
| `invalid_bank_status` | El estado bancario del gasto no es válido. |
| `file_too_large` | El archivo es muy pesado: el máximo es 15 MB. Envía la foto con menor calidad o como PDF. |
| `unsupported_file_type` | No podemos leer ese tipo de archivo. Envía una foto (JPG, PNG o WebP) o un PDF. |
| `owner_only` | Solo quien registró el gasto puede cambiarlo. |
| `line_correction_forbidden` | Solo quien registró el gasto o quien lo revisa puede corregir sus líneas. |
| `unknown_concept` | Ese concepto no existe en la compañía. |
| `review_forbidden` | Solo el aprobador del empleado puede revisar este gasto. |
| `expense_not_processable` | Este gasto ya se está leyendo. |
| `expense_not_editable` | Este gasto ya no se puede editar porque está in_review. |
| `fields_not_editable` | Estos campos no se pueden editar: total. |
| `expense_not_confirmable` | Este gasto no se puede confirmar porque está in_review. |
| `missing_total_currency` | Para confirmar el gasto falta el total o la moneda. |
| `converted_amount_required` | La factura está en USD y el anticipo en COP: indica el valor equivalente en COP. |
| `settlement_amount_required` | No se pudo completar la acción. |
| `withdrawal_rate_missing` | No se pudo completar la acción. |
| `withdrawal_same_currency` | Ese retiro está en la misma moneda del anticipo: no hace falta registrarlo. |
| `withdrawal_fee_expense` | Esta comisión es de un retiro: cámbiala o bórrala desde el retiro. |
| `justification_required` | Este gasto necesita una justificación antes de confirmarlo. |
| `policy_blocked` | Este gasto está bloqueado por la política de gastos. Puedes corregirlo, descartarlo o esperar la revisión de tu aprobador. |
| `expense_not_reviewable` | Solo se revisan gastos confirmados o bloqueados por la política. |
| `exception_note_required` | Para aceptar una excepción a la política, escribe una nota con el motivo. |
| `unknown_rule_type` | La regla outside_trip_dates no existe. |
| `unknown_rule_params` | La regla outside_trip_dates no tiene estos parámetros: tolerancia. |
| `invalid_concept_code` | El código solo puede tener minúsculas, números y guion bajo, por ejemplo: alcohol. |
| `concept_exists` | Ya existe un concepto con ese código. |
| `unknown_category` | No se pudo completar la acción. |
| `category_exists` | Ya existe una categoría con ese código. |
| `unknown_example_label` | No se pudo completar la acción. |
| `example_not_pending` | Esta corrección ya fue validada o rechazada. |
| `self_validation` | No puedes validar tu propia corrección; lo hace tu aprobador. |
| `example_edit_forbidden` | Solo contabilidad, o el aprobador que la creó, puede editar esta corrección aprendida. |
| `invalid_month` | El mes debe tener el formato AAAA-MM, por ejemplo 2026-10. |
| `invalid_month_range` | El mes inicial debe ser anterior o igual al mes final. |
| `budget_import_invalid` | El archivo no se cargó: hay 3 filas con problemas. Revisa el detalle, corrígelas y vuelve a subirlo. |
| `invalid_spreadsheet` | No pudimos leer el archivo. Súbelo en formato Excel (.xlsx) con la plantilla de tarifas. |
| `unknown_setting` | No se pudo completar la acción. |
| `setting_missing` | No se pudo completar la acción. |
| `setting_int` | No se pudo completar la acción. |
| `setting_decimal` | No se pudo completar la acción. |
| `setting_bool` | No se pudo completar la acción. |
| `setting_string` | No se pudo completar la acción. |
| `setting_max_length` | No se pudo completar la acción. |
| `setting_options` | No se pudo completar la acción. |
| `setting_list` | No se pudo completar la acción. |
| `setting_json` | No se pudo completar la acción. |
| `setting_min` | No se pudo completar la acción. |
| `setting_max` | No se pudo completar la acción. |
| `service_not_configured` | El almacenamiento de archivos (R2) no está configurado. |
| `ai_unavailable` | El servicio de lectura de facturas no respondió. Lo intentaremos de nuevo automáticamente. |
| `storage_unavailable` | No pudimos guardar o leer el archivo de la factura. Intenta de nuevo en unos minutos. |
| `whatsapp_unavailable` | No pudimos comunicarnos con WhatsApp. Intenta de nuevo en unos minutos. |
| `exchange_rates_unavailable` | No pudimos consultar las tasas de cambio. Se intentará de nuevo automáticamente. |

## Problemas por campo (errores 422)

| Clave | Texto |
|---|---|
| `default` | El valor no es válido. |
| `missing` | Este campo es obligatorio. |
| `string_too_short` | Es demasiado corto (mínimo {min_length} caracteres). |
| `string_too_long` | Es demasiado largo (máximo {max_length} caracteres). |
| `too_short` | Le faltan elementos (mínimo {min_length}). |
| `too_long` | Tiene demasiados elementos (máximo {max_length}). |
| `greater_than` | Debe ser mayor que {gt}. |
| `greater_than_equal` | Debe ser mayor o igual a {ge}. |
| `less_than_equal` | Debe ser menor o igual a {le}. |
| `int_parsing` | Debe ser un número entero. |
| `int_type` | Debe ser un número entero. |
| `decimal_parsing` | Debe ser un número. |
| `decimal_max_places` | Tiene demasiados decimales (máximo {decimal_places}). |
| `decimal_max_digits` | Tiene demasiados dígitos. |
| `float_parsing` | Debe ser un número. |
| `bool_parsing` | Debe ser verdadero o falso. |
| `uuid_parsing` | No es un identificador válido. |
| `date_parsing` | Debe ser una fecha con formato AAAA-MM-DD. |
| `date_from_datetime_parsing` | Debe ser una fecha con formato AAAA-MM-DD. |
| `datetime_parsing` | Debe ser una fecha y hora en formato ISO 8601. |
| `datetime_from_date_parsing` | Debe ser una fecha y hora en formato ISO 8601. |
| `enum` | Valor no permitido. Opciones: {expected}. |
| `literal_error` | Valor no permitido. Opciones: {expected}. |
| `string_type` | Debe ser un texto. |
| `list_type` | Debe ser una lista. |
| `dict_type` | Debe ser un objeto. |
| `json_invalid` | El cuerpo de la petición no es un JSON válido. |
| `extra_forbidden` | Este campo no se permite. |
| `value_error` | El valor no es válido. |
