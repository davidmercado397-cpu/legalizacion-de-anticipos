/**
 * Contrato de la API. `openapi.d.ts` se genera (pnpm --filter @viaticos/contracts generar); aquí solo van
 * alias legibles para el cliente. Los valores en dinero llegan como texto decimal ("1530000.00").
 */
import type { components, paths } from './openapi';

export type { components, paths };

type S = components['schemas'];

export type Rol = S['Role'];
export type Empleado = S['EmployeeOut'];
export type EmpleadoCreado = S['EmployeeCreatedOut'];
export type EmpleadoNuevo = S['EmployeeIn'];
export type EmpleadoCambios = S['EmployeePatch'];
export type Compania = S['CompanyOut'];
export type CompaniaNueva = S['CompanyIn'];
export type CompaniaCambios = S['CompanyPatch'];

export type Login = S['LoginIn'];
export type RespuestaLogin = S['LoginOut'];
export type Tokens = S['TokenOut'];
export type ConfiguracionMfa = S['MfaSetupOut'];

export type Anticipo = S['AdvanceOut'];
/** En los listados, con el nombre de quien lo pidió. */
export type AnticipoResumen = S['AdvanceListItemOut'];
export type AnticipoDetalle = S['AdvanceDetailOut'];
export type SolicitudAnticipo = S['AdvanceIn'];
export type EstadoAnticipo = S['AdvanceStatus'];
export type TipoAnticipo = S['AdvanceKind'];
export type Saldo = S['BalanceOut'];
export type PasoAprobacion = S['ApprovalStepOut'];
export type MotivoEscalamiento = S['EscalationReasonOut'];
/** Cuándo escala al jefe directivo: tolerancia sobre el presupuesto y monto total por moneda. */
export type ReglasAprobacion = S['ApprovalRulesIO-Output'];
export type ReglasAprobacionNuevas = S['ApprovalRulesIO-Input'];
export type SaldoAbierto = S['OpenBalanceOut'];
export type Viaje = S['TripIn'];
export type Presupuesto = S['BudgetOut'];
export type EventoLinea = S['TimelineEventOut'];
export type Devolucion = S['ReturnIn'];
export type SugerenciaDevolucion = S['ReturnSuggestionOut'];
export type Desembolso = S['DisburseIn'];
export type MetodoDesembolso = S['DisbursementMethod'];
export type Retiro = S['WithdrawalOut'];
export type NuevoRetiro = S['WithdrawalIn'];
export type CambioRetiro = S['WithdrawalPatch'];
export type Liquidacion = S['SettleIn'];
export type MetodoLiquidacion = S['SettlementMethod'];

export type Gasto = S['ExpenseOut'];
export type GastoDetalle = S['ExpenseDetailOut'];
export type LineaGasto = S['ExpenseLineOut'];
export type CorreccionGasto = S['ExpensePatch'];
export type Confirmacion = S['ConfirmIn'];
export type EstadoGasto = S['ExpenseStatus'];
export type DecisionRevision = S['ReviewDecision'];
export type TipoDocumento = S['DocumentType'];

export type Categoria = S['CategoryOut'];
export type ReglaPolitica = S['PolicyRuleOut'];
export type ReglaPoliticaNueva = S['PolicyRuleIn'];
export type ConceptoBloqueado = S['BlockedConceptOut'];

export type SaldoPendiente = S['PendingBalanceOut'];

export interface Paginacion {
  limit: number;
  offset: number;
  total: number;
}
export interface Pagina<T> {
  data: T[];
  pagination: Paginacion;
}
export interface Lista<T> {
  data: T[];
}

/** Forma única de los errores de la API (apps/api/docs/API_CONTRACT.md). */
export interface CuerpoError {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>[];
    request_id: string;
  };
}

/** Conciliación con el extracto de la tarjeta. */
export type Extracto = S['StatementOut'];
export type MovimientoExtracto = S['MovementOut'];
export type VistaPreviaExtracto = S['StatementPreviewOut'];
export type PerfilExtracto = S['StatementProfileIO'];
export type DecisionCargo = S['ChargeDecision'];
export type MedioDePago = S['PaymentMethod'];

/** Presupuesto de viaje: zonas (lugares) y tarifas zona × tipo de personal × categoría. */
export type ZonaViaje = S['TravelZoneOut'];
export type ZonaViajeNueva = S['TravelZoneIn'];
export type ZonaViajeCambios = S['TravelZonePatch'];
export type Tarifa = S['TravelRateOut'];
export type TarifaNueva = S['TravelRateIn'];
export type TipoPersonal = S['StaffType'];
export type UnidadTarifa = S['BudgetUnit'];

/** Aprobador suplente por un periodo y código para vincular WhatsApp. */
export type Suplencia = S['DelegationOut'];
export type SuplenciaNueva = S['DelegationIn'];
export type CodigoWhatsApp = S['LinkCodeOut'];
export type EstadoWhatsApp = S['WhatsAppLinkStatus'];

/** Deducibilidad sugerida de un gasto (la decide contabilidad) y lo que el sistema aprendió de las correcciones. */
export type Deducibilidad = S['Deductibility'];
export type DesgloseDeducibilidad = S['DeductibilityOut'];
export type Aprendizaje = S['ExampleOut'];
export type AprendizajeCambios = S['ExamplePatch'];
export type HistorialAprendizaje = S['ExampleHistoryOut'];
export type TipoAprendizaje = S['ExampleKind'];
export type EstadoAprendizaje = S['ExampleStatus'];
export type AlcanceAprendizaje = S['ExampleScope'];

/** Tableros de contabilidad (todos tienen su Excel con `?format=xlsx`). */
export type GastoPorConcepto = S['SpendOut'];
export type CumplimientoPresupuesto = S['BudgetComplianceOut'];
export type FacturaOtraCompania = S['IntercompanyOut'];
export type PrecisionIa = S['AccuracyOut'];
export type UsoMes = S['UsageOut'];

/** Operador de la plataforma (superadmin de NextByte) y auditoría. */
export type CostosIa = S['AiCostsOut'];
export type TotalesCostoIa = S['AiCostTotalsOut'];
export type Configuracion = S['SettingOut'];
export type RegistroAuditoria = S['AuditOut'];
