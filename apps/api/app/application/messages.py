"""Textos para el usuario. Viven en un solo módulo para que cambiar la redacción nunca toque la lógica."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.domain.enums import ExpenseWarning
from app.domain.ports import CategoryHint

WARNING_LABELS = {
    ExpenseWarning.LOW_CONFIDENCE: "no estoy seguro de haber leído bien algunos datos, revísalos 👀",
    ExpenseWarning.VERIFICATION_FAILED: "los valores de la factura no cuadran entre sí, revísalos",
    ExpenseWarning.QR_MISMATCH: "el total leído no coincide con el QR de la factura",
    ExpenseWarning.POOR_LEGIBILITY: "foto poco legible",
    ExpenseWarning.CURRENCY_MISMATCH: "moneda distinta a la del anticipo",
    ExpenseWarning.UNSUPPORTED_CURRENCY: "no reconozco la moneda de la factura, revísala",
}

REACTION_RECEIVED = "⏳"
REACTION_OK = "✅"
REACTION_WARNING = "⚠️"
REACTION_ERROR = "❌"


@dataclass(frozen=True)
class NumberFormat:
    """Separadores de cada país (defaults.countries[X].number_format). Por defecto, el colombiano."""

    thousands: str = "."
    decimal: str = ","
    always_decimals: bool = False

    @classmethod
    def of(cls, spec: Mapping[str, Any] | None) -> NumberFormat:
        if not spec:
            return cls()
        return cls(str(spec.get("thousands", ".")), str(spec.get("decimal", ",")), bool(spec.get("always_decimals", False)))


COLOMBIAN = NumberFormat()


def money(amount: Decimal | None, currency: str | None, fmt: NumberFormat = COLOMBIAN) -> str:
    """$1.234.567 en Colombia, $1,234,567.50 en Panamá o México (decimales según el país)."""
    if amount is None:
        return "—"
    quantized = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    integer, _, cents = f"{abs(quantized):.2f}".partition(".")
    grouped = f"{int(integer):,}".replace(",", fmt.thousands)
    text = f"${grouped}" + (f"{fmt.decimal}{cents}" if cents != "00" or fmt.always_decimals else "")
    sign = "-" if quantized < 0 else ""
    return f"{sign}{text} {currency or ''}".strip()


def category_label(code: str | None, categories: Mapping[str, CategoryHint]) -> str:
    """Las categorías son de cada compañía (tabla expense_categories)."""
    hint = categories.get(code or "")
    if hint is None:
        return "🧾 Sin categoría"
    return f"{hint.emoji} {hint.name}" if hint.emoji else hint.name


NOT_REGISTERED = (
    "Hola 👋 Este número no está registrado para legalizar gastos.\n"
    "Si trabajas en la compañía, pide a contabilidad que te registre, o comparte tu número con el "
    "botón de abajo para vincular tu cuenta."
)
NOT_REGISTERED_SHORT = "Este número no está registrado. Contacta a contabilidad para que te registren."
LINK_OK = (
    "✅ Listo {name}, tu WhatsApp quedó vinculado. {assistant}Te ayudo con tus gastos de viaje: envíame la foto de "
    "cada factura y yo la leo."
)
DEFAULT_ASSISTANT = "el asistente de gastos de viaje"
LINK_FAILED = "No pude vincular tu cuenta con ese código. Verifica que sea el último código generado en la app."
LINK_CONFIRM_FAILED = "No pude confirmar tu identidad. Contacta a contabilidad."
RATE_LIMITED = "😅 Vas muy rápido. Espera un minuto y sigue; lo que ya enviaste no se perdió."
# Menú y conversación
GREETING = "Hola {name} 👋 {assistant}¿Qué necesitas?"
ASSISTANT_INTRO = "Soy {assistant}. "
MENU_PROMPT = "¿En qué más te ayudo?"
MENU_PHOTO_HINT = "📸 Para registrar un gasto, envíame la foto de la factura."
MENU_BUTTON = "Ver opciones"
# Opción -> (título de la fila, máximo 24 caracteres; descripción, máximo 72).
MENU_OPTIONS = {
    "advances": ("💰 Mis anticipos", "Estado de cada anticipo"),
    "balance": ("💵 Saldo", "Entregado, legalizado y disponible"),
    "pending": ("📝 Pendientes", "Gastos por confirmar"),
    "expenses": ("🧾 Mis gastos", "Corregir o descartar un gasto"),
    "request": ("➕ Solicitar anticipo", "Pide un anticipo para un viaje"),
    "submit": ("📤 Enviar legalización", "Manda tu legalización a revisión"),
    "approvals": ("✅ Por aprobar", "Anticipos de tu equipo"),
}
FAREWELL = "¡Con gusto, {name}! Aquí estoy cuando me necesites 👋"
MY_ADVANCES = "💰 Tus anticipos:"
NO_ADVANCES = "Todavía no tienes anticipos. Puedes solicitar uno desde el menú."
ADVANCE_ITEM = "• *{label}* · {status} · {amount}"
ADVANCE_RETURNED_NOTE = "   ↩️ Te la devolvieron: {note}"
BALANCE_ITEM = "💰 *{label}*\n   Entregado: {amount}\n   Legalizado: {applied}\n   Pendiente: {pending}"
BALANCE_FUNCTIONAL = "   En {currency}: pendiente {pending} (tasa {rate} del {day})"
PENDING_PROMPT = "📝 Tienes {what} por confirmar. Elige uno para verlo:"
EXPENSES_PROMPT = "🧾 Tus últimos gastos. Elige uno para verlo, corregirlo o descartarlo:"
EXPENSES_BUTTON = "Ver gastos"
NO_EXPENSES = "Todavía no tienes gastos en tus anticipos abiertos. Envíame la foto de una factura 📸"
REQUEST_IN_APP = "➕ Solicita el anticipo en la app: ahí ves el valor calculado con las tarifas de viaje."
SUBMIT_PROMPT = "¿Qué legalización quieres enviar?"
SUBMIT_SUMMARY = "📤 *{label}*\nLegalizado: {applied} de {amount} en {count}."
SUBMIT_QUESTION = "¿La envío a revisión?"
APPROVAL_ITEM = "👤 {name} pide {amount} para {label}."
APPROVAL_JUSTIFICATION = "Pidió otro valor que el calculado ({budget}): {justification}"
APPROVALS_MORE = "Hay {count} más: revísalas en la app."
NOTHING_TO_APPROVE = "No tienes anticipos por aprobar 👍"
IDLE_REMINDER = "{name}, quedó pendiente: {what}. Cuando puedas, lo revisamos 👇"
IDLE_UNREADABLE = "una foto que no pude leer (envíamela de nuevo)"
BUTTON_APPROVE = "✅ Aprobar"
BUTTON_REJECT = "❌ Rechazar"
BUTTON_SEE_PENDING = "📝 Ver pendientes"
BUTTON_SEND = "📤 Enviar"
SLOW_NOTICE = "Sigo revisando tu factura, te aviso en un momento ⏳"
PROCESSING_FAILED = "❌ No pude leer una de tus facturas. Puedes completarla manualmente en la app."
UNREADABLE = "❌ La foto salió borrosa o cortada. ¿Me la envías de nuevo, con buena luz y completa?"
NOT_A_RECEIPT = "🤔 Esto no parece una factura ni un recibo. ¿Me envías la foto del comprobante? 📸"
NO_OPEN_ADVANCES = "No tienes anticipos abiertos en este momento."
NO_PENDING = "No tienes gastos pendientes por confirmar. 👍"
CONFIRMED_ONE = "✅ Gasto confirmado."
CONFIRM_QUESTION = "¿Está bien?"
CONFIRMED_BALANCE = "📌 En {label} te quedan {pending} por legalizar."
DISCARDED = "🗑️ Gasto descartado."
ASSIGN_PROMPT = "¿A qué anticipo asigno {what}?"
ASSIGN_BUTTON = "Elegir anticipo"
NO_ADVANCE_FOR_EXPENSES = (
    "📭 Todavía no tienes un anticipo aprobado, así que no registré esta factura. "
    "Solicita uno y, cuando te lo aprueben, me envías las fotos de tus facturas."
)
BUTTON_REQUEST_ADVANCE = "➕ Solicitar anticipo"
ASSIGNED = "📌 Asignado a: {label}."
ACTION_NOT_ALLOWED = "No puedes realizar esa acción."
ADVANCE_APPROVED_BY_WA = "✅ Anticipo de {name} aprobado."
ADVANCE_STEP_APPROVED_BY_WA = "✅ Aprobaste el anticipo de {name}. Falta la aprobación de {next}."
ADVANCE_REJECTED_BY_WA = "❌ Anticipo de {name} rechazado."
# Títulos de botón: máximo 20 caracteres (límite de Meta).
BUTTON_OK = "✅ Está bien"
BUTTON_CORRECT = "✏️ Corregir"
BUTTON_JUSTIFY = "✍️ Justificar"
BUTTON_DISCARD = "🗑️ Descartar"
BUTTON_CHANGE_ADVANCE = "🔁 Cambiar anticipo"
BUTTON_SUBMIT = "📤 Enviar a revisión"

# Detalle de cada factura (un mensaje por factura).
DETAIL_TAX_ID = "NIT {tax_id}"
DETAIL_NUMBER = "Factura {number}"
DETAIL_MORE_LINES = "…y {count} más"
DETAIL_SUBTOTAL = "Base: {amount}"
DETAIL_TAX = "{label}{rate}: {amount}"
DETAIL_TIP = "Propina: {amount}"
DETAIL_DISCOUNT = "Descuento: -{amount}"
DETAIL_TOTAL = "*Total: {amount}*"
DETAIL_CONVERTED = "Equivale a {amount} (tasa {rate} del {day})"
DETAIL_ADVANCE = "📌 Anticipo {label} · saldo al confirmar: {pending}"
DETAIL_ADVANCE_BY_DATE = "📌 Por la fecha lo asigné a {label} · saldo al confirmar: {pending}"
REVIEW_READING = "👀 Es un recibo sin código QR: revisa que el total y la fecha estén bien leídos."
TAX_LABELS = {"iva": "IVA", "inc": "Impoconsumo", "ieps": "IEPS", "itbms": "ITBMS", "other": "Otro impuesto"}
DUPLICATE_OWN = "👍 Esta factura ya la tengo registrada ({what}), así que no la sumé otra vez."
# WhatsApp Flows (formularios). El llamado a la acción: máximo 30 caracteres y sin emojis.
FLOW_CORRECT_TEXT = "✏️ Corrige lo que haga falta y guarda: el gasto queda confirmado."
FLOW_CORRECT_CTA = "Corregir"
FLOW_JUSTIFY_TEXT = "✍️ Cuéntame por qué este gasto es del viaje y lo confirmo."
FLOW_JUSTIFY_CTA = "Justificar"
FLOW_REQUEST_TEXT = "➕ Completa los datos del viaje y te muestro el valor calculado con las tarifas de viaje."
FLOW_BUDGET = "💰 Valor calculado con las tarifas de viaje: {amount}. Si pides otro valor, explica por qué."
FLOW_NO_BUDGET = "No hay tarifas de viaje para este destino: escribe el valor del anticipo."
FLOW_REQUEST_CTA = "Solicitar anticipo"
FLOW_EXPIRED = "⌛ Ese formulario venció. Ábrelo de nuevo desde el menú."
FLOW_INVALID = "No pude leer los datos del formulario. Ábrelo de nuevo y revísalos."
JUSTIFY_REASON = "La política de gastos pide una justificación para este gasto."
ADVANCE_REQUESTED = "📨 Listo, pedí tu anticipo de {amount} para {label}. Te aviso cuando lo aprueben."
CORRECTED_CONFIRMED = "✏️ Listo, lo corregí y quedó confirmado."
ADVANCE_KIND_LABELS = {"cash": "Efectivo", "reloadable_card": "Tarjeta recargable", "corporate_card": "Tarjeta corporativa"}
DOCUMENT_TYPE_LABELS = {
    "electronic_invoice": "Factura electrónica",
    "pos_ticket": "Tiquete POS",
    "cash_receipt": "Recibo de caja",
    "other": "Otro",
}
PAYMENT_METHOD_LABELS = {"card": "Tarjeta", "cash": "Efectivo", "transfer": "Transferencia"}
FLOW_UNSET = "Sin definir"
FLOW_BY_ADVANCE = "Según el anticipo"
CORRECT_IN_APP = "✏️ Para corregir este gasto entra a la app: ahí puedes cambiar cualquier dato y confirmarlo."
JUSTIFY_IN_APP = "✍️ Escribe la justificación en la app y confirma el gasto desde ahí."
MOVE_PROMPT = "¿A qué anticipo paso este gasto?"
MOVED = "📌 Listo, quedó en {label}."
SUBMITTED = "📤 Listo, envié tu legalización a revisión. Te aviso cuando tu aprobador la revise."

# Avisos de estado del anticipo. Cada uno tiene su versión de una línea para la plantilla de aviso.
NOTICE_APPROVED = "✅ {approver} aprobó tu anticipo {label} por {amount}."
NOTICE_INVOICE_TO = "🧾 Pide tus facturas a nombre de *{legal_name}*, NIT {tax_id}."
NOTICE_APPROVED_LINE = "{approver} aprobó tu anticipo {label} por {amount}"
NOTICE_REJECTED = "❌ {approver} no aprobó tu anticipo {label}."
NOTICE_REJECTED_LINE = "{approver} no aprobó tu anticipo {label}"
NOTICE_VOIDED = "🚫 Contabilidad anuló tu anticipo {label}."
NOTICE_VOIDED_LINE = "contabilidad anuló tu anticipo {label}"
NOTICE_NOTE = "Motivo: {note}"
NOTICE_RETURNED = "↩️ {approver} te devolvió la legalización de {label} para cambios."
NOTICE_RETURNED_MARKS = "Marcó {what} para revisar."
NOTICE_RETURNED_LINE = "{approver} te devolvió la legalización de {label} para cambios"
NOTICE_CLOSED = "✅ {approver} aprobó tu legalización de {label}."
NOTICE_CLOSED_LINE = "{approver} aprobó tu legalización de {label}"
NOTICE_SETTLEMENT = {
    "none": "Quedó en cero 👌",
    "refund_pending": "Te queda por reintegrar {amount}. Tesorería te dirá cómo hacerlo.",
    "payment_pending": "Gastaste {amount} más del anticipo: la compañía te los reembolsa.",
}
NOTICE_DISBURSED = "💸 Tesorería te entregó el anticipo {label} ({amount})."
NOTICE_DISBURSED_LINE = "tesorería te entregó el anticipo {label} ({amount})"
BUTTON_SEE_MARKED = "↩️ Ver marcados"
MARKED_PROMPT = "↩️ Estos gastos te los marcaron para revisar. Elige uno:"
NO_MARKED = "No tienes gastos marcados por revisar 👍"

# Recordatorio de legalizar: el texto completo va dentro de la ventana de 24 h; afuera, la línea
# corta como parámetro de la plantilla (sin saltos de línea, como exige Meta).
LEGALIZATION_REMINDER = "⏰ {name}, tu viaje a {destination} terminó el {end}. Llevas legalizado {applied} de {amount}."
LEGALIZATION_REMINDER_PENDING = "Antes de enviarla, confirma o descarta {what}."
LEGALIZATION_REMINDER_SUBMIT = "Cuando esté completa, envíala a revisión con el botón."
LEGALIZATION_REMINDER_NOTICE = (
    "tu viaje a {destination} terminó el {end}; recuerda enviar la legalización ({applied} de {amount})"
)

# Por qué una solicitud escala al jefe directivo (decisiones 4.1 y 4.2).
ESCALATION_LABELS = {
    "over_budget": "Supera en más del {tolerance_pct} % el presupuesto calculado ({budget})",
    "over_threshold": "Supera el monto de {threshold} que exige la aprobación del jefe directivo",
}


def escalation_text(reason: Mapping[str, Any], currency: str) -> str:
    values = {
        "tolerance_pct": _plain_number(reason.get("tolerance_pct")),
        "budget": money(Decimal(str(reason["budget"])), currency) if reason.get("budget") else "—",
        "threshold": money(Decimal(str(reason["threshold"])), currency) if reason.get("threshold") else "—",
    }
    return ESCALATION_LABELS.get(str(reason.get("code")), str(reason.get("code"))).format(**values)


def _plain_number(value: object) -> str:
    """10.00 -> 10; 7.5 -> 7,5."""
    if value is None:
        return "—"
    return f"{Decimal(str(value)).normalize():f}".replace(".", ",")


APPROVAL_LEVEL_LABELS = {"boss": "el jefe inmediato", "director": "el jefe directivo", "management": "la gerencia"}

FINDING_LABELS = {
    "duplicate_invoice": "Esta factura ya está registrada",
    "blocked_concept": "Incluye {concepts} ({amount}), que no es reembolsable",
    "possible_blocked_concept": "Podría incluir {concepts}, revísalo",
    "owner_concept_override": "Marcaste como permitido algo que parecía {concepts}: lo revisará tu aprobador",
    "outside_trip_dates": "La fecha de la factura ({invoice_date}) está fuera de las fechas del viaje",
    "missing_tax_id": "La factura no tiene NIT. Si puedes, pide una con NIT; si no, igual queda registrada",
    "invalid_tax_id": "El NIT de la factura no parece correcto. Revísalo; si está bien así, igual queda registrada",
    "receipt_cap_exceeded": "Este recibo es de {value} y el tope para recibos sin factura es {cap}",
    "monthly_cap_exceeded": "Con este recibo llevas {value} este mes en recibos sin factura; el tope es {cap}",
    "yearly_cap_exceeded": "Con este recibo llevas {value} este año en recibos sin factura; el tope es {cap}",
    "not_itemized": "La factura no detalla los productos; para este valor se necesita la factura detallada",
    "invoice_not_to_company": "La factura no está a nombre de {legal_name}: pídela con el NIT {tax_id} para que sea deducible",
    "invoice_to_other_group_company": "La factura está a nombre de {company}, otra compañía del grupo",
    "receipt_missing_data": "Al recibo le falta: {fields}. Complétalo",
    "receipt_not_signed": "El recibo de caja debe estar firmado por quien te vendió",
    "missing_fiscal_id": "La factura electrónica no trae el CUFE (o código de validación): la revisará contabilidad",
    "excessive_tip": "La propina ({tip}) supera la sugerida ({suggested}): el exceso no es reembolsable",
}
NEEDS_JUSTIFICATION_HINT = "✍️ Necesita una justificación antes de confirmarse"
BLOCKED_HINT = "⛔ Bloqueado: lo revisará tu aprobador"
NEEDS_JUSTIFICATION = "✍️ Este gasto necesita una justificación antes de confirmarse. Complétala en la app."
BLOCKED_BY_POLICY = "⛔ Este gasto está bloqueado por la política de gastos; lo revisará tu aprobador."


# ---------------------------------------------------------------------------------------------
# Errores (API y bot). Cada código de `app/domain/errors.py` tiene aquí su texto para el usuario.
# ---------------------------------------------------------------------------------------------


def plural(count: int, singular: str, many: str) -> str:
    return f"{count} {singular if count == 1 else many}"


ENTITY_LABELS = {
    "advance": "el anticipo",
    "expense": "el gasto",
    "employee": "el usuario",
    "company": "la compañía",
    "file": "el archivo",
    "line": "esa línea de la factura",
    "blocked concept": "ese concepto",
    "category": "esa categoría",
    "exchange rate": "una tasa de cambio reciente para esas monedas en esa fecha",
    "travel zone": "esa zona de viaje",
    "travel rate": "esa tarifa de viaje",
    "travel budget": "tarifas de viaje para ese destino y esas fechas",
    "deductibility": "el desglose de deducibilidad (al gasto le falta el total)",
    "delegation": "esa suplencia",
    "example": "esa corrección aprendida",
    "statement": "ese extracto",
    "movement": "ese movimiento del extracto",
    "route": "esa ruta",
}
ADVANCE_STATUS_LABELS = {
    "requested": "pendiente de aprobación",
    "approved": "abierto",
    "rejected": "rechazado",
    "in_review": "en revisión",
    "closed": "cerrado",
    "cancelled": "cancelado",
    "voided": "anulado",
}
SETTLEMENT_STATUS_LABELS = {
    "none": "sin diferencia",
    "refund_pending": "con reintegro pendiente",
    "refunded": "reintegrado",
    "payroll_deducted": "descontado por nómina",
    "payment_pending": "con pago pendiente al empleado",
    "paid": "pagado al empleado",
}

EXPENSE_STATUS_LABELS = {
    "received": "recibido",
    "processing": "en lectura",
    "extracted": "pendiente de confirmar",
    "confirmed": "confirmado",
    "discarded": "descartado",
    "unreadable": "ilegible",
    "failed": "sin leer",
}
ADVANCE_ACTION_LABELS = {
    "approve": "aprobar",
    "reject": "rechazar",
    "submit": "enviar a revisión",
    "close": "cerrar",
    "return": "devolver",
    "cancel": "cancelar",
    "void": "anular",
    "reopen": "reabrir",
    "disburse": "registrar la entrega de",
}
SERVICE_LABELS = {
    "r2": "El almacenamiento de archivos (R2)",
    "whatsapp": "WhatsApp",
    "siesa": "Siesa",
    "openrouter": "El servicio de lectura con IA",
    "whatsapp_welcome_template": "La plantilla de bienvenida de WhatsApp",
    "whatsapp_approval_template": "La plantilla de aprobación de anticipos de WhatsApp",
}

ErrorText = str | Callable[[dict[str, Any]], str]

# Aparte para que bandit (B105) no confunda estos textos con contraseñas escritas en el código.
_PASSWORD_MESSAGES: dict[str, ErrorText] = {  # nosec B105
    "password_too_short": "La contraseña debe tener al menos {min} caracteres.",
    "password_spaces": "La contraseña no puede empezar ni terminar con espacios.",
    "password_contains_email": "La contraseña no puede contener tu correo.",
    "wrong_current_password": "La contraseña actual no es correcta.",
    "password_change_required": "Debes cambiar tu contraseña temporal antes de continuar.",
}

ERROR_MESSAGES: dict[str, ErrorText] = {
    **_PASSWORD_MESSAGES,
    # Genéricos (uno por tipo de error)
    "domain_error": "No se pudo completar la acción.",
    "not_found": lambda p: f"No encontramos {ENTITY_LABELS.get(p.get('entity', ''), 'lo que buscas')}.",
    "forbidden": "Tu usuario no tiene permiso para hacer esto.",
    "invalid_state": "Esta acción no se puede hacer en el estado actual.",
    "conflict": "Ese dato ya está registrado.",
    "validation_error": "Revisa los datos enviados.",
    "session_expired": "Tu sesión expiró. Vuelve a iniciar sesión.",
    "external_service_error": "Un servicio externo no respondió. Intenta de nuevo en unos minutos.",
    "internal_error": "Tuvimos un problema interno. Intenta de nuevo; si se repite, comparte este código con soporte: {request_id}.",
    "method_not_allowed": "Esa acción no está disponible en esta ruta.",
    # Autenticación y cuenta
    "invalid_credentials": "El correo o la contraseña no son correctos.",
    "login_required": "Debes iniciar sesión.",
    "account_locked": lambda p: (
        "Tu cuenta quedó bloqueada por varios intentos fallidos. "
        f"Intenta de nuevo en {plural(p.get('minutes', 1), 'minuto', 'minutos')}."
    ),
    "rate_limited": "Hiciste demasiadas solicitudes seguidas. Espera {seconds} segundos e intenta de nuevo.",
    "mfa_setup_required": "Tu rol exige verificación en dos pasos. Actívala antes de continuar.",
    "invalid_mfa_code": "El código de verificación no es correcto o ya se usó.",
    "mfa_already_enabled": "La verificación en dos pasos ya está activa.",
    "mfa_setup_not_started": "Primero inicia la activación de la verificación en dos pasos.",
    "mfa_unavailable": "No pudimos validar tu verificación en dos pasos. Pide al administrador que la restablezca.",
    "mfa_self_reset": "No puedes restablecer tu propia verificación en dos pasos; pídeselo a otro administrador.",
    # Usuarios y compañías
    "own_role_change": "No puedes cambiar tu propio rol.",
    "superadmin_reserved": "Ese rol es exclusivo del operador de la plataforma y no se puede asignar.",
    "self_deactivation": "No puedes desactivar tu propio usuario.",
    "email_taken": "Ya hay un usuario con el correo {email}.",
    "phone_taken": "Ese celular ya está registrado a otro usuario.",
    "no_company": "El usuario debe pertenecer al menos a una compañía.",
    "unknown_company": "La compañía indicada no existe.",
    "self_approver": "Un usuario no puede ser su propio aprobador.",
    "invalid_approver": "El aprobador debe ser un usuario activo con rol de aprobador, contabilidad o administrador.",
    "invalid_country": "El país debe ser un código de dos letras, por ejemplo CO, PA o MX.",
    "unsupported_currency": "No trabajamos con la moneda {currency}. Las monedas habilitadas son: {supported}.",
    "unknown_country": "No tenemos configurado el país {country}. Indica la zona horaria de la compañía.",
    "invalid_timezone": "La zona horaria {timezone} no existe. Usa el formato de la IANA, por ejemplo America/Bogota.",
    "invalid_deductibility": "La regla de deducibilidad para {document_type} no es válida.",
    "duplicate_value": "Ese dato ya está registrado en otro registro.",
    # Anticipos y legalizaciones
    "foreign_company": "Solo puedes solicitar anticipos para las compañías en las que trabajas.",
    "amount_not_positive": "El valor debe ser mayor que cero.",
    "negative_amount": "El valor del anticipo no puede ser negativo.",
    "end_before_start": "La fecha de regreso no puede ser anterior a la de salida.",
    "erp_advance_not_approved": "El anticipo se crea en Siesa cuando termina su aprobación.",
    "erp_legalization_not_closed": "Primero cierra la legalización; después se crea en Siesa.",
    "erp_already_sent": "Esto ya está en Siesa.",
    "legs_overlap": "Las fechas de {first} y {second} se cruzan. El destino siguiente puede empezar el día en que termina el anterior, no antes.",
    "trip_without_legs": "Agrega al menos un destino con sus fechas.",
    "budget_rate_unavailable": "No hay tasa de cambio reciente de {currency} para calcular el presupuesto en dólares. Escribe el valor a mano.",
    "invalid_advance_transition": lambda p: (
        f"No se puede {ADVANCE_ACTION_LABELS.get(p.get('action', ''), 'cambiar')} un anticipo que está "
        f"{ADVANCE_STATUS_LABELS.get(p.get('status', ''), p.get('status', ''))}."
    ),
    "self_decision": "No puedes aprobar ni revisar tu propio anticipo. Lo debe hacer tu aprobador.",
    "not_your_approver": "No eres el aprobador de este empleado.",
    "owner_submits": "Solo el dueño del anticipo puede enviar la legalización.",
    "pending_expenses": lambda p: (
        "Antes de enviar la legalización, confirma o descarta "
        + ("el gasto pendiente." if p.get("count") == 1 else f"los {p.get('count')} gastos pendientes.")
    ),
    "unreviewed_findings": lambda p: (
        "Antes de cerrar, revisa "
        + (
            "el gasto con alertas de política."
            if p.get("count") == 1
            else f"los {p.get('count')} gastos con alertas de política."
        )
    ),
    "note_required": "Escribe una nota con el motivo.",
    "advance_has_expenses": (
        "Este anticipo ya tiene gastos aplicados, así que no se puede anular. Legalízalo y ciérralo: la diferencia "
        "queda como reintegro."
    ),
    "advance_already_settled": "Esta legalización ya se liquidó (reintegro o pago registrado), así que no se puede reabrir.",
    "advance_already_disbursed": "La entrega de este anticipo ya está registrada.",
    "invalid_settlement": lambda p: (
        f"No hay nada que liquidar de esa forma: el anticipo está {SETTLEMENT_STATUS_LABELS.get(p.get('status', ''), 'sin diferencia')}."
    ),
    "invalid_delegation": (
        "La suplencia debe ser entre dos personas distintas, el suplente debe ser un aprobador activo y la fecha final "
        "debe ser posterior a la inicial."
    ),
    "anonymize_active_user": "Solo se pueden borrar los datos de contacto de usuarios desactivados.",
    "legalization_locked": "La legalización ya fue enviada o cerrada. Para cambiar algo, pide que te la devuelvan.",
    "advance_not_open": "Ese anticipo no está abierto para recibir gastos.",
    "no_open_advance": "No tienes un anticipo aprobado. Solicita uno y, cuando te lo aprueben, registra tus facturas.",
    "advance_required": "Elige a qué anticipo va este gasto antes de confirmarlo.",
    "advance_of_other": "Ese anticipo es de otra persona.",
    "amount_required": "Indica el valor del anticipo: no hay tarifas de viaje para calcularlo.",
    "escalation_justification_required": (
        "Esta solicitud necesita la aprobación del jefe directivo (supera el presupuesto o el monto configurado): "
        "explica por qué la necesitas."
    ),
    "no_approver_available": "No hay quién apruebe este viaje: pide que te asignen un jefe o que creen un usuario de gerencia.",
    "invalid_approval_tolerance": "La tolerancia debe estar entre 0 % y 100 %.",
    "invalid_approval_threshold": "Cada umbral debe tener una moneda de 3 letras y un valor mayor que cero.",
    "budget_justification_required": (
        "El valor calculado con las tarifas de viaje es {budget}. Si necesitas otro valor, explica por qué."
    ),
    "budget_currency_mismatch": "Las tarifas de este destino están en {budget_currency}: pide el anticipo en esa moneda.",
    "budget_rates_missing": "Las tarifas de este destino están en varias monedas. Pide a contabilidad que las revise.",
    "staff_type_missing": "Tu usuario no tiene tipo de personal (administrativo u operativo). Pídele a contabilidad que lo configure.",
    "cash_cap_exceeded": "El efectivo en moneda extranjera tiene un tope de {cap}. Pide el resto en tarjeta o en pesos.",
    "cash_cap_unverifiable": "No tenemos la tasa de cambio de hoy para verificar el tope de efectivo. Intenta más tarde.",
    "invalid_cash_cap": "El tope de efectivo debe tener un valor mayor que cero y una moneda habilitada.",
    # Gastos
    # Conciliación con el extracto bancario
    "statement_pdf_no_preview": "Los extractos en PDF no tienen vista previa: se leen con IA al cargarlos.",
    "statement_already_loaded": "Este archivo de extracto ya fue cargado.",
    "statement_without_charges": "No encontramos cargos en el extracto. Revisa qué columna es la del valor y el formato de las fechas.",
    "statement_profile_invalid": "Indica la columna de la fecha, la de la descripción y la del valor (o las de débito y crédito).",
    "statement_unsupported_format": "El extracto debe ser CSV, Excel (.xlsx) o PDF.",
    "statement_unreadable": "No pudimos abrir el archivo del extracto. Revisa que no esté dañado o protegido con clave.",
    "invalid_card_last4": "Escribe los 4 últimos dígitos de la tarjeta.",
    "statement_legalization_not_sent": "El extracto se carga cuando el empleado ya envió la legalización a revisión.",
    "statement_legalization_closed": "La legalización ya no está en revisión: los cruces con el extracto no se pueden cambiar.",
    "movement_not_matched": "Ese movimiento no está cruzado con ningún gasto.",
    "movement_not_charge": "Solo los cargos del extracto se cruzan con gastos.",
    "movement_already_matched": "Ese cargo ya está cruzado: deshaz el cruce primero.",
    "movement_not_decidable": "Solo se decide sobre cargos del extracto que no tienen factura.",
    "expense_already_matched": "Ese gasto ya está cruzado en otro extracto.",
    "statement_rate_missing": "No hay tasa de cambio para convertir el cargo desde {currency}. Intenta más tarde.",
    "unresolved_bank_items": lambda p: (
        f"Antes de aprobar la legalización, resuelve {plural(int(p.get('count', 0)), 'movimiento', 'movimientos')} "
        "del extracto: confirma o descarta las sugerencias y decide los cargos sin factura."
    ),
    "invalid_bank_status": "El estado bancario del gasto no es válido.",
    "file_too_large": "El archivo es muy pesado: el máximo es {max_mb} MB. Envía la foto con menor calidad o como PDF.",
    "unsupported_file_type": "No podemos leer ese tipo de archivo. Envía una foto (JPG, PNG o WebP) o un PDF.",
    "owner_only": "Solo quien registró el gasto puede cambiarlo.",
    "line_correction_forbidden": "Solo quien registró el gasto o quien lo revisa puede corregir sus líneas.",
    "unknown_concept": "Ese concepto no existe en la compañía.",
    "review_forbidden": "Solo el aprobador del empleado puede revisar este gasto.",
    "expense_not_processable": "Este gasto ya se está leyendo.",
    "expense_not_editable": lambda p: (
        f"Este gasto ya no se puede editar porque está {EXPENSE_STATUS_LABELS.get(p.get('status', ''), p.get('status', ''))}."
    ),
    "fields_not_editable": "Estos campos no se pueden editar: {fields}.",
    "expense_not_confirmable": lambda p: (
        f"Este gasto no se puede confirmar porque está {EXPENSE_STATUS_LABELS.get(p.get('status', ''), p.get('status', ''))}."
    ),
    "missing_total_currency": "Para confirmar el gasto falta el total o la moneda.",
    "converted_amount_required": (
        "La factura está en {expense_currency} y el anticipo en {advance_currency}: indica el valor equivalente en "
        "{advance_currency}."
    ),
    "justification_required": "Este gasto necesita una justificación antes de confirmarlo.",
    "policy_blocked": (
        "Este gasto está bloqueado por la política de gastos. Puedes corregirlo, descartarlo o esperar la revisión de tu "
        "aprobador."
    ),
    "expense_not_reviewable": "Solo se revisan gastos confirmados o bloqueados por la política.",
    "exception_note_required": "Para aceptar una excepción a la política, escribe una nota con el motivo.",
    # Políticas
    "unknown_rule_type": "La regla {rule} no existe.",
    "unknown_rule_params": "La regla {rule} no tiene estos parámetros: {params}.",
    "invalid_concept_code": "El código solo puede tener minúsculas, números y guion bajo, por ejemplo: alcohol.",
    "concept_exists": "Ya existe un concepto con ese código.",
    "unknown_category": "La categoría {category} no existe o está desactivada en la compañía.",
    "category_exists": "Ya existe una categoría con ese código.",
    "unknown_example_label": "La etiqueta {label} no existe en la compañía.",
    "example_not_pending": "Esta corrección ya fue validada o rechazada.",
    "self_validation": "No puedes validar tu propia corrección; lo hace tu aprobador.",
    "example_edit_forbidden": "Solo contabilidad, o el aprobador que la creó, puede editar esta corrección aprendida.",
    "invalid_month": "El mes debe tener el formato AAAA-MM, por ejemplo 2026-10.",
    "invalid_month_range": "El mes inicial debe ser anterior o igual al mes final.",
    "budget_import_invalid": lambda p: (
        "El archivo no se cargó: "
        + ("hay 1 fila con problemas." if p.get("count") == 1 else f"hay {p.get('count')} filas con problemas.")
        + " Revisa el detalle, corrígelas y vuelve a subirlo."
    ),
    "invalid_spreadsheet": "No pudimos leer el archivo. Súbelo en formato Excel (.xlsx) con la plantilla de tarifas.",
    # Configuración del sistema (superadmin)
    "unknown_setting": "Estas llaves de configuración no existen: {keys}.",
    "setting_missing": "Falta el parámetro de configuración {key}. Pide al administrador de la plataforma que lo cargue.",
    "setting_int": "{key} debe ser un número entero.",
    "setting_decimal": "{key} debe ser un número.",
    "setting_bool": "{key} debe ser verdadero o falso.",
    "setting_string": "{key} debe ser un texto.",
    "setting_max_length": "{key} admite máximo {limit} caracteres.",
    "setting_options": "{key} solo admite estos valores: {options}.",
    "setting_list": "{key} debe ser una lista de textos.",
    "setting_json": "{key} debe ser un objeto o una lista.",
    "setting_min": "{key} debe ser mayor o igual a {limit}.",
    "setting_max": "{key} debe ser menor o igual a {limit}.",
    # Integraciones
    "service_not_configured": lambda p: f"{SERVICE_LABELS.get(p.get('service', ''), 'Una integración')} no está configurado.",
    "ai_unavailable": "El servicio de lectura de facturas no respondió. Lo intentaremos de nuevo automáticamente.",
    "storage_unavailable": "No pudimos guardar o leer el archivo de la factura. Intenta de nuevo en unos minutos.",
    "whatsapp_unavailable": "No pudimos comunicarnos con WhatsApp. Intenta de nuevo en unos minutos.",
    "exchange_rates_unavailable": "No pudimos consultar las tasas de cambio. Se intentará de nuevo automáticamente.",
}


def error_message(code: str, params: dict[str, Any] | None = None) -> str:
    template = ERROR_MESSAGES.get(code) or ERROR_MESSAGES["domain_error"]
    values = params or {}
    if callable(template):
        return template(values)
    try:
        return template.format(**values)
    except (KeyError, IndexError):
        # Si falta un parámetro se devuelve el genérico antes que mostrar llaves sin reemplazar.
        return str(ERROR_MESSAGES["domain_error"])


# Problemas por campo en los datos enviados (errores 422 de validación de la API).
VALIDATION_ISSUES = {
    "default": "El valor no es válido.",
    "missing": "Este campo es obligatorio.",
    "string_too_short": "Es demasiado corto (mínimo {min_length} caracteres).",
    "string_too_long": "Es demasiado largo (máximo {max_length} caracteres).",
    "too_short": "Le faltan elementos (mínimo {min_length}).",
    "too_long": "Tiene demasiados elementos (máximo {max_length}).",
    "greater_than": "Debe ser mayor que {gt}.",
    "greater_than_equal": "Debe ser mayor o igual a {ge}.",
    "less_than_equal": "Debe ser menor o igual a {le}.",
    "int_parsing": "Debe ser un número entero.",
    "int_type": "Debe ser un número entero.",
    "decimal_parsing": "Debe ser un número.",
    "decimal_max_places": "Tiene demasiados decimales (máximo {decimal_places}).",
    "decimal_max_digits": "Tiene demasiados dígitos.",
    "float_parsing": "Debe ser un número.",
    "bool_parsing": "Debe ser verdadero o falso.",
    "uuid_parsing": "No es un identificador válido.",
    "date_parsing": "Debe ser una fecha con formato AAAA-MM-DD.",
    "date_from_datetime_parsing": "Debe ser una fecha con formato AAAA-MM-DD.",
    "datetime_parsing": "Debe ser una fecha y hora en formato ISO 8601.",
    "datetime_from_date_parsing": "Debe ser una fecha y hora en formato ISO 8601.",
    "enum": "Valor no permitido. Opciones: {expected}.",
    "literal_error": "Valor no permitido. Opciones: {expected}.",
    "string_type": "Debe ser un texto.",
    "list_type": "Debe ser una lista.",
    "dict_type": "Debe ser un objeto.",
    "json_invalid": "El cuerpo de la petición no es un JSON válido.",
    "extra_forbidden": "Este campo no se permite.",
    "value_error": "El valor no es válido.",
}


def pending_expenses(count: int) -> str:
    return "el gasto pendiente" if count == 1 else f"los {count} gastos pendientes"


def expenses_count(count: int) -> str:
    return plural(count, "gasto", "gastos")


# Línea de tiempo de un anticipo (acciones de la auditoría).
TIMELINE_LABELS = {
    "advance_requested": "Solicitado",
    "advance_approve": "Aprobado",
    "advance_reject": "Rechazado",
    "advance_cancel": "Cancelado",
    "advance_void": "Anulado",
    "advance_disburse": "Entregado por tesorería",
    "advance_submitted": "Enviado a revisión",
    "advance_return": "Devuelto para cambios",
    "advance_close": "Legalización aprobada",
    "advance_reopen": "Reabierto",
    "advance_settle": "Diferencia liquidada",
    "erp_advance_created": "Creado en Siesa",
    "erp_advance_failed": "Siesa no recibió el anticipo",
    "erp_legalization_created": "Legalización creada en Siesa",
    "erp_legalization_failed": "Siesa no recibió la legalización",
    "statement_uploaded": "Extracto de la tarjeta cargado",
    "statement_movement_decided": "Cruce con el extracto revisado",
}

# Comentario sugerido al devolver una legalización, por hallazgo o advertencia del gasto.
RETURN_SUGGESTIONS = {
    "duplicate_invoice": "Parece una factura repetida: confirma que no la registraste dos veces.",
    "blocked_concept": "Incluye un concepto no reembolsable: descártalo o justifícalo.",
    "possible_blocked_concept": "Revisa si incluye un concepto no reembolsable.",
    "outside_trip_dates": "La fecha está fuera del viaje: explica el motivo.",
    "missing_tax_id": "La factura no tiene NIT: si puedes, consigue una con NIT.",
    "invalid_tax_id": "Revisa el NIT de la factura.",
    "receipt_cap_exceeded": "Supera el tope para recibos sin factura: consigue la factura o justifícalo.",
    "monthly_cap_exceeded": "Supera el tope mensual de recibos sin factura: justifícalo.",
    "yearly_cap_exceeded": "Supera el tope anual de recibos sin factura: justifícalo.",
    "not_itemized": "Para este valor se necesita la factura detallada.",
    "low_confidence": "Revisa que los datos leídos coincidan con la factura.",
    "verification_failed": "Los valores no cuadran entre sí: revisa el total y los impuestos.",
    "qr_mismatch": "El total no coincide con el QR de la factura: revísalo.",
    "currency_mismatch": "Revisa el valor convertido a la moneda del anticipo.",
    "invoice_not_to_company": "La factura no está a nombre de la compañía: pide que la emitan con su NIT.",
    "invoice_to_other_group_company": "La factura está a nombre de otra compañía del grupo: confirma a cuál corresponde.",
    "receipt_missing_data": "Al recibo le faltan datos: complétalos.",
    "receipt_not_signed": "El recibo debe estar firmado por quien te vendió.",
    "missing_fiscal_id": "La factura electrónica no trae el CUFE: confirma que sea una factura válida.",
    "excessive_tip": "La propina supera la sugerida: el exceso no se reembolsa.",
    "owner_concept_override": "Cambiaste el concepto de una línea marcada como no reembolsable: explica por qué.",
}
RECEIPT_FIELD_LABELS = {
    "concept": "el concepto",
    "date": "la fecha",
    "total": "el valor",
    "vendor": "el nombre de quien vende",
    "vendor_tax_id": "la identificación de quien vende",
}

AGING_NO_DATE = "sin fecha"
NO_COMPANY = "Sin compañía"
YES = "Sí"
NO = "No"
REPORT_COLUMNS = {
    "pending_balances": [
        "Compañía",
        "Empleado",
        "Destino",
        "Estado",
        "Moneda",
        "Anticipo",
        "Legalizado",
        "Pendiente",
        "Fin del viaje",
        "Días",
        "Antigüedad",
    ],
    "spend": ["Compañía", "Categoría", "País", "Moneda", "Gastos", "Total"],
    "budget": ["Compañía", "Empleado", "Categoría", "Moneda", "Presupuesto", "Legalizado", "Diferencia"],
    "intercompany": ["Compañía del anticipo", "Factura a nombre de", "Empleado", "Proveedor", "Fecha", "Moneda", "Total"],
    "ai_costs": [
        "Mes",
        "Modelo",
        "Compañía",
        "De prueba",
        "Lecturas",
        "Tokens de entrada",
        "Tokens de salida",
        "Tokens en caché",
        "Costo (USD)",
    ],
    "usage": ["Compañía", "Comprobantes", "Lecturas de IA", "Escaladas", "Costo IA (USD)", "Latencia promedio (ms)"],
}

DEDUCTIBILITY_NOTE = "Sugerencia calculada por línea; el criterio tributario lo define contabilidad."

# Plantilla de tarifas de viaje en Excel: columnas zona, tipo_personal, categoria, valor, moneda,
# unidad, desde, hasta. Se aceptan los valores en español o en inglés.
STAFF_TYPE_ALIASES = {
    "administrativo": "administrative",
    "administrative": "administrative",
    "operativo": "operational",
    "operational": "operational",
}
BUDGET_UNIT_ALIASES = {
    "dia": "per_day",
    "día": "per_day",
    "por dia": "per_day",
    "por día": "per_day",
    "per_day": "per_day",
    "noche": "per_night",
    "por noche": "per_night",
    "per_night": "per_night",
    "viaje": "per_trip",
    "por viaje": "per_trip",
    "per_trip": "per_trip",
}
BUDGET_IMPORT_ISSUES = {
    "unknown_zone": "La zona '{value}' no existe. Créala primero o revisa cómo está escrita.",
    "unknown_staff_type": "El tipo de personal '{value}' no existe. Usa administrativo u operativo.",
    "unknown_unit": "La unidad '{value}' no existe. Usa día, noche o viaje.",
    "invalid_amount": "El valor debe ser un número mayor que cero.",
    "invalid_date": "La fecha debe tener formato AAAA-MM-DD.",
}


# Descripción de cada tipo de regla de política (se muestra en la configuración de la compañía).
RULE_DESCRIPTIONS = {
    "duplicate": "Factura repetida en la compañía: mismo CUFE, mismo NIT y número, mismo proveedor, fecha y total, o la misma foto.",
    "missing_tax_id": "La factura no tiene NIT o el dígito de verificación no cuadra; se registra con el tercero genérico.",
    "outside_trip_dates": "La fecha de la factura está fuera del viaje: se aceptan desde la salida hasta 1 día después del regreso.",
    "blocked_concept": "Líneas con un concepto no reembolsable (licor, minibar…); si la IA no está segura, solo alerta.",
    "non_fiscal_document": "Topes para recibos de caja y notas a mano: por recibo y acumulado por empleado al mes y al año.",
    "itemized_required": "Facturas por encima de un valor deben detallar los productos.",
    "buyer_not_company": (
        "La factura electrónica debe estar a nombre de la compañía del anticipo; a nombre de otra compañía del grupo "
        "se alerta para reclasificarla. No aplica a facturas del exterior."
    ),
    "low_confidence": "La IA no está segura del proveedor, la fecha o el total.",
    "missing_fiscal_id": "Factura electrónica sin CUFE, UUID o chave de acesso: la decide contabilidad.",
    "excessive_tip": "Propina por encima de la sugerida (porcentaje del consumo); el exceso no es reembolsable.",
}
