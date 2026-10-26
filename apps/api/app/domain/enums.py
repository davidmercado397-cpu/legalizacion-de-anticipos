"""Se persisten por valor (string) para que la BD se pueda leer a ojo."""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    EMPLOYEE = "employee"  # pide anticipos y registra gastos
    APPROVER = "approver"  # además aprueba a quienes le reportan
    ACCOUNTANT = "accountant"  # contabilidad: revisa y cierra legalizaciones, políticas, exportes
    TREASURY = "treasury"  # tesorería: desembolsos, extractos bancarios, reintegros y reembolsos
    MANAGEMENT = "management"  # gerencia: aprueba los viajes de los directivos (quien no tiene jefe)
    ADMIN = "admin"  # usuarios, compañías y configuración de negocio de Forsa
    # Operador de la plataforma (NextByte): parámetros del sistema y métricas de uso. No pertenece a
    # ninguna compañía ni ve gastos, anticipos o datos personales de Forsa (mínimo privilegio).
    SUPERADMIN = "superadmin"


class WhatsAppLinkStatus(StrEnum):
    NONE = "none"  # aún sin identidad de WhatsApp vinculada
    PENDING = "pending"  # bienvenida enviada, BSUID capturado, esperando que el usuario confirme
    ACTIVE = "active"  # BSUID confirmado: el usuario ya puede hablar con el bot


class AdvanceKind(StrEnum):
    CASH = "cash"
    RELOADABLE_CARD = "reloadable_card"
    CORPORATE_CARD = "corporate_card"


class AdvanceStatus(StrEnum):
    REQUESTED = "requested"  # esperando aprobación
    APPROVED = "approved"  # "bolsa" abierta: recibe gastos
    REJECTED = "rejected"
    IN_REVIEW = "in_review"  # legalización enviada, esperando revisión
    CLOSED = "closed"  # legalización aprobada
    CANCELLED = "cancelled"  # solicitud retirada antes de aprobarse
    VOIDED = "voided"  # aprobado pero anulado (viaje cancelado) sin gastos aplicados


class ExpenseStatus(StrEnum):
    RECEIVED = "received"  # llegó el archivo (o su referencia de Meta), aún sin procesar
    PROCESSING = "processing"
    EXTRACTED = "extracted"  # leído por la IA; esperando que el usuario confirme
    CONFIRMED = "confirmed"
    DISCARDED = "discarded"
    UNREADABLE = "unreadable"  # no se pudo leer la foto; se le pide al usuario reenviarla
    FAILED = "failed"  # se agotaron los reintentos; se puede completar a mano


class ExpenseSource(StrEnum):
    WHATSAPP = "whatsapp"
    APP = "app"
    BANK = "bank"  # cargo del extracto sin factura que la empresa asume (conciliación)
    WITHDRAWAL_FEE = "withdrawal_fee"  # comisión de un retiro en el exterior (la registra el viajero o tesorería)


class DocumentType(StrEnum):
    ELECTRONIC_INVOICE = "electronic_invoice"  # factura electrónica DIAN, factura fiscal de Panamá, CFDI de México
    POS_TICKET = "pos_ticket"
    CASH_RECEIPT = "cash_receipt"  # recibo de caja, nota a mano, cuenta de cobro
    OTHER = "other"


class TaxType(StrEnum):
    IVA = "iva"  # IVA (Colombia, México)
    INC = "inc"  # impuesto nacional al consumo (Colombia: restaurantes)
    IEPS = "ieps"  # México
    ITBMS = "itbms"  # Panamá
    OTHER = "other"


class Legibility(StrEnum):
    GOOD = "good"
    POOR = "poor"
    UNREADABLE = "unreadable"


class ExpenseWarning(StrEnum):
    LOW_CONFIDENCE = "low_confidence"
    VERIFICATION_FAILED = "verification_failed"  # aritmética, dígito de verificación del NIT, fechas...
    QR_MISMATCH = "qr_mismatch"  # la IA leyó un valor distinto al del QR fiscal
    POOR_LEGIBILITY = "poor_legibility"
    CURRENCY_MISMATCH = "currency_mismatch"
    UNSUPPORTED_CURRENCY = "unsupported_currency"  # moneda fuera de las soportadas: la revisa una persona


class UnreadableReason(StrEnum):
    UNREADABLE = "unreadable"  # borrosa, cortada u oscura
    NOT_A_RECEIPT = "not_a_receipt"  # la foto no es una factura ni un recibo


class Channel(StrEnum):
    API = "api"
    WHATSAPP = "whatsapp"
    SYSTEM = "system"


class PolicyAction(StrEnum):
    WARN = "warn"  # se le muestra al usuario y al aprobador, nada más
    REQUIRE_JUSTIFICATION = "require_justification"  # el usuario debe justificar antes de confirmar
    BLOCK = "block"  # el usuario no puede confirmar; decide el aprobador en la revisión
    REVIEW = "review"  # no frena al empleado, pero contabilidad debe decidir antes de cerrar la legalización


class Deductibility(StrEnum):
    DEDUCTIBLE = "deductible"
    NON_DEDUCTIBLE = "non_deductible"
    REQUIRES_SUPPORT_DOCUMENT = "requires_support_document"  # documento soporte DIAN para no obligados a facturar
    REQUIRES_REVIEW = "requires_review"  # lo define contabilidad (p. ej. facturas del exterior)


class ReviewStatus(StrEnum):
    NOT_REQUIRED = "not_required"  # sin hallazgos de política
    PENDING = "pending"
    ACCEPTED = "accepted"
    ACCEPTED_PARTIAL = "accepted_partial"  # aceptado sin las líneas bloqueadas
    REJECTED = "rejected"


class ReviewDecision(StrEnum):
    ACCEPT_WITHOUT_BLOCKED = "accept_without_blocked"
    ACCEPT_FULL = "accept_full"
    REJECT = "reject"


class ExchangeRateSource(StrEnum):
    TRM = "trm"  # TRM oficial USD/COP de la Superfinanciera
    ECB = "ecb"  # tasa de referencia del Banco Central Europeo (vía Frankfurter)
    ECB_CROSS = "ecb_cross"  # cruce: moneda -> USD (BCE) -> COP (TRM)
    MANUAL = "manual"  # valor convertido que digitó el usuario o contabilidad
    WITHDRAWAL = "withdrawal"  # pagado en efectivo con un retiro: la tasa del retiro (FIFO)


class ExchangeRatePolicy(StrEnum):
    DAILY = "daily"  # tasa del día de la factura
    PREVIOUS_MONTH_CLOSE = "previous_month_close"  # tasa del cierre del mes anterior a la factura


class StaffType(StrEnum):
    """Tipo de personal: define qué tarifa del presupuesto de viaje le aplica."""

    ADMINISTRATIVE = "administrative"
    OPERATIONAL = "operational"


class BudgetUnit(StrEnum):
    PER_DAY = "per_day"  # alimentación, transporte local
    PER_NIGHT = "per_night"  # hospedaje
    PER_TRIP = "per_trip"  # tiquetes, traslados al aeropuerto
    PER_15_DAYS = "per_15_days"  # plan de internet: uno por cada 15 días (en cada tramo, porque cambia el país)


class DisbursementMethod(StrEnum):
    CASH = "cash"
    TRANSFER = "transfer"
    CARD = "card"  # recarga de tarjeta


class SettlementStatus(StrEnum):
    """Qué pasa con la diferencia al cerrar la legalización."""

    NONE = "none"  # sin diferencia
    REFUND_PENDING = "refund_pending"  # el empleado debe devolver lo no gastado
    REFUNDED = "refunded"
    PAYROLL_DEDUCTED = "payroll_deducted"
    PAYMENT_PENDING = "payment_pending"  # la compañía le debe al empleado (gastó más)
    PAID = "paid"


class SettlementMethod(StrEnum):
    REFUND = "refund"  # el empleado consignó o devolvió el efectivo
    PAYROLL_DEDUCTION = "payroll_deduction"
    PAYMENT = "payment"  # la compañía le pagó al empleado


class ExampleKind(StrEnum):
    LINE_CONCEPT = "line_concept"  # texto de una línea -> concepto bloqueado (o "none": permitido)
    VENDOR_CATEGORY = "vendor_category"  # NIT del proveedor -> categoría


class ExampleScope(StrEnum):
    COMPANY = "company"
    GROUP = "group"  # aplica en todas las compañías; la de la compañía manda en un conflicto


class ExampleStatus(StrEnum):
    ACTIVE = "active"
    PENDING = "pending"  # corrección de un empleado: espera que la valide su aprobador
    REJECTED = "rejected"
    INACTIVE = "inactive"


class ApprovalLevel(StrEnum):
    """Niveles de la ruta de aprobación de una solicitud (decisiones 4.1 a 4.5)."""

    BOSS = "boss"  # jefe inmediato
    DIRECTOR = "director"  # jefe directivo (el jefe del jefe): cuando la solicitud escala
    MANAGEMENT = "management"  # gerencia: viajes de directivos, o si falta el jefe directivo


class StepStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    SKIPPED = "skipped"  # el nivel superior aprobó antes y este paso ya no hace falta


class ErpStatus(StrEnum):
    """Envío a Siesa del anticipo o de su legalización."""

    PENDING = "pending"  # todavía no se envía, o Siesa aún no está conectado
    SENT = "sent"
    FAILED = "failed"  # Siesa respondió con error: contabilidad lo reintenta


class PaymentMethod(StrEnum):
    """Cómo pagó el empleado; solo los pagos con tarjeta se cruzan con el extracto."""

    CARD = "card"
    CASH = "cash"
    TRANSFER = "transfer"


class MatchStatus(StrEnum):
    """Cruce de un cargo del extracto con un gasto. AUTO y SUGGESTED los propone el sistema y se
    recalculan; CONFIRMED y MANUAL los decidió contabilidad y el recálculo no los toca."""

    AUTO = "auto"
    SUGGESTED = "suggested"
    CONFIRMED = "confirmed"
    MANUAL = "manual"


class ChargeDecision(StrEnum):
    """Qué hace contabilidad con un cargo del extracto que no tiene factura (decisión 7.6)."""

    ABSORB = "absorb"  # lo asume la empresa: cuenta como legalizado
    DISCOUNT = "discount"  # se le descuenta al empleado: queda en lo que debe reintegrar


class BankStatus(StrEnum):
    """Estado de un gasto pagado con tarjeta frente al extracto."""

    MATCHED = "matched"  # se legaliza por el valor que cobró el banco (decisión 7.8)
    NO_CHARGE = "no_charge"  # el extracto cubre su fecha y no trae el cargo: alerta a contabilidad (7.7)
