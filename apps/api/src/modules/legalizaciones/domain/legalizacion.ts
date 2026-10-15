import {
  DomainError,
  FechaCalendario,
  Money,
  invariante,
  normalizarIdentificacionTributaria,
} from '@viaticos/shared-kernel';
import { AgregadoRaiz, type EventoDominio } from '../../../shared/domain/agregado-raiz';
import { evaluarExclusion, type ReglaExclusion } from './reglas-exclusion';
import type {
  Alerta,
  ArchivoSoporte,
  CategoriaGasto,
  DatosExtraidos,
  DatosSoporte,
  DecisionContable,
  LineaSoporte,
} from './tipos';

export type EstadoLegalizacion = 'ABIERTA' | 'EN_REVISION' | 'DEVUELTA' | 'APROBADA';
export type EstadoSoporte = 'PROCESANDO' | 'POR_CONFIRMAR' | 'CONFIRMADO';
export type TipoSoporte = 'FACTURA' | 'RECIBO_CAJA';

/** Tercero contable para compras sin factura (proveedores varios). */
export const TERCERO_PROVEEDORES_VARIOS = '222';

export interface Soporte {
  id: string;
  tipo: TipoSoporte;
  estado: EstadoSoporte;
  descripcionUsuario: string;
  archivo: ArchivoSoporte | null;
  extraccion: DatosExtraidos | null;
  datos: DatosSoporte | null;
  alertas: Alerta[];
  decision: DecisionContable | null;
  /** Solo recibos de caja: a quién se le compró (opcional, no es el viajero). */
  beneficiario: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface EventoHistorial {
  tipo: 'ENVIADA' | 'DEVUELTA' | 'APROBADA';
  usuarioId: string;
  comentario: string | null;
  en: Date;
}

export interface LegalizacionProps {
  id: string;
  anticipoId: string;
  viajeroId: string;
  montoAnticipo: Money;
  viaje: { inicio: FechaCalendario; fin: FechaCalendario };
  estado: EstadoLegalizacion;
  soportes: Soporte[];
  historial: EventoHistorial[];
  creadaEn: Date;
  actualizadaEn: Date;
  version: number;
}

/** Contexto que la aplicación reúne para confirmar un soporte (configuración y otros módulos). */
export interface ContextoConfirmacion {
  nitEmpresa: string;
  reglas: readonly ReglaExclusion[];
  duplicidad: { veredicto: 'UNICO' | 'SOSPECHOSO'; detalle: string | null };
}

export interface LegalizacionAprobada extends EventoDominio {
  tipo: 'legalizaciones.LegalizacionAprobada';
  anticipoId: string;
  viajeroId: string;
}

export interface SoporteEliminado extends EventoDominio {
  tipo: 'legalizaciones.SoporteEliminado';
  soporteId: string;
}

export interface ResumenLegalizacion {
  totalAceptado: Money;
  totalExcluido: Money;
  /** Positivo: el viajero devuelve. Negativo: la empresa le reembolsa. */
  saldo: Money;
}

const MARGEN_DIAS_VIAJE = 1;

/** Una legalización por anticipo: reúne todos los soportes del viaje y calcula el saldo. */
export class Legalizacion extends AgregadoRaiz {
  private constructor(private props: LegalizacionProps) {
    super();
  }

  static abrir(datos: {
    id: string;
    anticipoId: string;
    viajeroId: string;
    montoAnticipo: Money;
    viaje: { inicio: FechaCalendario; fin: FechaCalendario };
    ahora: Date;
  }): Legalizacion {
    return new Legalizacion({
      ...datos,
      estado: 'ABIERTA',
      soportes: [],
      historial: [],
      creadaEn: datos.ahora,
      actualizadaEn: datos.ahora,
      version: 0,
    });
  }

  static rehidratar(props: LegalizacionProps): Legalizacion {
    return new Legalizacion(props);
  }

  get id() {
    return this.props.id;
  }
  get anticipoId() {
    return this.props.anticipoId;
  }
  get viajeroId() {
    return this.props.viajeroId;
  }
  get montoAnticipo() {
    return this.props.montoAnticipo;
  }
  get viaje() {
    return this.props.viaje;
  }
  get estado() {
    return this.props.estado;
  }
  get soportes(): readonly Soporte[] {
    return this.props.soportes;
  }
  get historial(): readonly EventoHistorial[] {
    return this.props.historial;
  }
  get creadaEn() {
    return this.props.creadaEn;
  }
  get version() {
    return this.props.version;
  }

  soporte(id: string): Soporte {
    const s = this.props.soportes.find((x) => x.id === id);
    if (!s) throw new DomainError('SOPORTE_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El soporte no existe');
    return s;
  }

  // ---------------- Viajero ----------------

  agregarFactura(datos: { soporteId: string; descripcion: string; archivo: ArchivoSoporte; ahora: Date }): Soporte {
    this.exigirEditable();
    const descripcion = datos.descripcion.trim();
    invariante(descripcion.length >= 5, 'DESCRIPCION_REQUERIDA', 'Describa brevemente para qué fue la compra');
    const soporte: Soporte = {
      id: datos.soporteId,
      tipo: 'FACTURA',
      estado: 'PROCESANDO',
      descripcionUsuario: descripcion,
      archivo: datos.archivo,
      extraccion: null,
      datos: null,
      alertas: [],
      decision: null,
      beneficiario: null,
      creadoEn: datos.ahora,
      actualizadoEn: datos.ahora,
    };
    this.props.soportes.push(soporte);
    this.tocar(datos.ahora);
    return soporte;
  }

  /** Resultado del OCR (null = no hubo lectura automática: el viajero digita los datos). */
  registrarExtraccion(soporteId: string, extraccion: DatosExtraidos | null, ahora: Date): void {
    const s = this.soporte(soporteId);
    if (s.estado !== 'PROCESANDO') return; // idempotente: un reintento del trabajo no pisa datos confirmados
    s.extraccion = extraccion;
    s.estado = 'POR_CONFIRMAR';
    s.alertas = extraccion
      ? []
      : [{ codigo: 'LECTURA_NO_DISPONIBLE', severidad: 'INFO', mensaje: 'No hubo lectura automática; datos digitados por el viajero' }];
    s.actualizadoEn = ahora;
    this.tocar(ahora);
  }

  /**
   * El viajero confirma (o corrige) los datos. Aquí se aplican las exclusiones por
   * línea y se calculan las alertas para contabilidad.
   */
  confirmarSoporte(soporteId: string, datos: DatosSoporte, contexto: ContextoConfirmacion, ahora: Date): Soporte {
    this.exigirEditable();
    const s = this.soporte(soporteId);
    if (s.tipo !== 'FACTURA' || s.estado === 'PROCESANDO') {
      throw new DomainError('SOPORTE_NO_CONFIRMABLE', 'CONFLICTO', 'El soporte aún se está procesando');
    }
    this.validarDatos(datos, ahora);
    invariante(datos.emisorNombre.trim().length > 0, 'EMISOR_REQUERIDO', 'Indique quién emitió la factura');

    const lineas: LineaSoporte[] = datos.lineas.map((l) => {
      const regla = evaluarExclusion(l.descripcion, contexto.reglas);
      return { ...l, excluida: regla !== null, motivoExclusion: regla?.config.nombre ?? null };
    });

    const alertas: Alerta[] = [];
    const nitEmpresa = normalizarIdentificacionTributaria(contexto.nitEmpresa);
    if (!datos.adquirienteId || normalizarIdentificacionTributaria(datos.adquirienteId) !== nitEmpresa) {
      alertas.push({
        codigo: 'NO_A_NOMBRE_EMPRESA',
        severidad: 'REVISION',
        mensaje: datos.adquirienteId
          ? `La factura está a nombre de ${datos.adquirienteId}, no del NIT de la empresa`
          : 'La factura no indica a nombre de quién se emitió',
      });
    }
    if (contexto.duplicidad.veredicto === 'SOSPECHOSO') {
      alertas.push({
        codigo: 'POSIBLE_DUPLICADO',
        severidad: 'REVISION',
        mensaje: contexto.duplicidad.detalle ?? 'Se parece a otra factura ya radicada',
      });
    }
    alertas.push(...this.alertasDeFecha(datos.fecha));
    if (!datos.claveFiscal && (datos.paisCodigo === 'CO' || datos.paisCodigo === 'BR')) {
      alertas.push({
        codigo: 'SIN_CLAVE_FISCAL',
        severidad: 'INFO',
        mensaje: datos.paisCodigo === 'CO' ? 'Factura colombiana sin CUFE/CUDE' : 'Nota brasileña sin chave de acesso',
      });
    }
    alertas.push(...alertasDeLineas(lineas, datos.total));

    s.datos = { ...datos, lineas };
    s.alertas = alertas;
    s.estado = 'CONFIRMADO';
    s.decision = null;
    s.actualizadoEn = ahora;
    this.tocar(ahora);
    return s;
  }

  /** Compra sin factura: recibo de caja a nombre de proveedores varios (tercero 222). */
  agregarReciboCaja(datos: {
    soporteId: string;
    descripcion: string;
    fecha: FechaCalendario;
    valor: Money;
    categoria: CategoriaGasto;
    medioPago: DatosSoporte['medioPago'];
    paisCodigo: string;
    beneficiario: string | null;
    archivo: ArchivoSoporte | null;
    tasa: DatosSoporte['tasa'];
    /** Tope configurado por contabilidad y el valor expresado en la moneda del tope. */
    tope: { tope: Money; valorEnMonedaTope: Money };
    ahora: Date;
  }): Soporte {
    this.exigirEditable();
    const descripcion = datos.descripcion.trim();
    invariante(descripcion.length >= 5, 'DESCRIPCION_REQUERIDA', 'Describa para qué fue la compra');
    if (datos.tope.valorEnMonedaTope.esMayorQue(datos.tope.tope)) {
      throw new DomainError(
        'TOPE_RECIBO_EXCEDIDO',
        'REGLA_NEGOCIO',
        `Un recibo de caja no puede superar ${datos.tope.tope}; para montos mayores se requiere factura`,
        { tope: datos.tope.tope.toDto() },
      );
    }
    const datosSoporte: DatosSoporte = {
      emisorNombre: datos.beneficiario?.trim() || 'Proveedores varios',
      emisorId: TERCERO_PROVEEDORES_VARIOS,
      adquirienteId: null,
      numeroDocumento: null,
      fecha: datos.fecha,
      total: datos.valor,
      claveFiscal: null,
      medioPago: datos.medioPago,
      ultimos4Tarjeta: null,
      paisCodigo: datos.paisCodigo,
      categoria: datos.categoria,
      lineas: [],
      tasa: datos.tasa,
    };
    this.validarDatos(datosSoporte, datos.ahora);

    const soporte: Soporte = {
      id: datos.soporteId,
      tipo: 'RECIBO_CAJA',
      estado: 'CONFIRMADO',
      descripcionUsuario: descripcion,
      archivo: datos.archivo,
      extraccion: null,
      datos: datosSoporte,
      alertas: [
        { codigo: 'RECIBO_CAJA_222', severidad: 'INFO', mensaje: 'Compra sin factura legalizada con recibo de caja (tercero 222)' },
        ...this.alertasDeFecha(datos.fecha),
      ],
      decision: null,
      beneficiario: datos.beneficiario?.trim() || null,
      creadoEn: datos.ahora,
      actualizadoEn: datos.ahora,
    };
    this.props.soportes.push(soporte);
    this.tocar(datos.ahora);
    return soporte;
  }

  eliminarSoporte(soporteId: string, ahora: Date): void {
    this.exigirEditable();
    this.soporte(soporteId);
    this.props.soportes = this.props.soportes.filter((s) => s.id !== soporteId);
    this.tocar(ahora);
    this.registrarEvento({
      tipo: 'legalizaciones.SoporteEliminado',
      agregadoId: this.id,
      ocurridoEn: ahora,
      soporteId,
    } satisfies SoporteEliminado);
  }

  enviarARevision(usuarioId: string, ahora: Date): void {
    this.exigirEditable();
    if (usuarioId !== this.props.viajeroId) {
      throw new DomainError('SOLO_EL_VIAJERO', 'NO_AUTORIZADO', 'Solo el viajero puede enviar su legalización');
    }
    invariante(this.props.soportes.length > 0, 'SIN_SOPORTES', 'Agregue al menos un soporte antes de enviar');
    const pendientes = this.props.soportes.filter((s) => s.estado !== 'CONFIRMADO');
    if (pendientes.length) {
      throw new DomainError('SOPORTES_SIN_CONFIRMAR', 'VALIDACION', 'Confirme los datos de todos los soportes antes de enviar', {
        pendientes: pendientes.map((s) => s.id),
      });
    }
    this.props.estado = 'EN_REVISION';
    this.agregarHistorial('ENVIADA', usuarioId, null, ahora);
  }

  // ---------------- Contabilidad ----------------

  /** Decide si un soporte con alertas de revisión aplica (no aplica = no se reconoce el gasto). */
  decidirSoporte(soporteId: string, decision: { aplica: boolean; comentario: string | null; contadorId: string }, ahora: Date): void {
    this.exigirEstado('EN_REVISION');
    this.exigirNoEsViajero(decision.contadorId);
    const s = this.soporte(soporteId);
    if (!decision.aplica && !decision.comentario?.trim()) {
      throw new DomainError('COMENTARIO_REQUERIDO', 'VALIDACION', 'Explique por qué el soporte no aplica');
    }
    s.decision = { ...decision, comentario: decision.comentario?.trim() || null, decididoEn: ahora };
    s.actualizadoEn = ahora;
    this.tocar(ahora);
  }

  aprobar(contadorId: string, ahora: Date): void {
    this.exigirEstado('EN_REVISION');
    this.exigirNoEsViajero(contadorId);
    const sinDecidir = this.props.soportes.filter((s) => requiereDecision(s) && !s.decision);
    if (sinDecidir.length) {
      throw new DomainError('ALERTAS_SIN_DECIDIR', 'VALIDACION', 'Decida si aplican los soportes con alertas antes de aprobar', {
        pendientes: sinDecidir.map((s) => s.id),
      });
    }
    this.props.estado = 'APROBADA';
    this.agregarHistorial('APROBADA', contadorId, null, ahora);
    this.registrarEvento({
      tipo: 'legalizaciones.LegalizacionAprobada',
      agregadoId: this.id,
      ocurridoEn: ahora,
      anticipoId: this.anticipoId,
      viajeroId: this.viajeroId,
    } satisfies LegalizacionAprobada);
  }

  devolver(contadorId: string, comentario: string, ahora: Date): void {
    this.exigirEstado('EN_REVISION');
    this.exigirNoEsViajero(contadorId);
    invariante(comentario.trim().length >= 5, 'COMENTARIO_REQUERIDO', 'Explique qué debe corregir el viajero');
    this.props.estado = 'DEVUELTA';
    this.agregarHistorial('DEVUELTA', contadorId, comentario.trim(), ahora);
  }

  // ---------------- Cálculos ----------------

  resumen(): ResumenLegalizacion {
    const moneda = this.props.montoAnticipo.moneda;
    let aceptado = Money.cero(moneda);
    let excluido = Money.cero(moneda);
    for (const s of this.props.soportes) {
      const montos = montosDelSoporte(s, moneda);
      aceptado = aceptado.sumar(montos.aceptado);
      excluido = excluido.sumar(montos.excluido);
    }
    return { totalAceptado: aceptado, totalExcluido: excluido, saldo: this.props.montoAnticipo.restar(aceptado) };
  }

  puedeVer(usuarioId: string, roles: readonly string[]): boolean {
    return usuarioId === this.props.viajeroId || roles.includes('CONTABILIDAD');
  }

  toSnapshot(): LegalizacionProps {
    return {
      ...this.props,
      soportes: this.props.soportes.map((s) => ({ ...s, alertas: [...s.alertas] })),
      historial: [...this.props.historial],
    };
  }

  // ---------------- Privados ----------------

  private validarDatos(datos: DatosSoporte, ahora: Date): void {
    invariante(!datos.total.esNegativo() && !datos.total.esCero(), 'TOTAL_INVALIDO', 'El total debe ser mayor que cero');
    invariante(
      datos.lineas.every((l) => l.valor.moneda === datos.total.moneda),
      'MONEDA_LINEAS',
      'Las líneas deben estar en la moneda del total',
    );
    const hoy = FechaCalendario.of(ahora.toISOString().slice(0, 10));
    invariante(!datos.fecha.esPosteriorA(hoy.sumarDias(1)), 'FECHA_FUTURA', 'La fecha del soporte no puede ser futura');
    const monedaAnticipo = this.props.montoAnticipo.moneda;
    if (datos.total.moneda !== monedaAnticipo) {
      invariante(
        datos.tasa?.origen === datos.total.moneda && datos.tasa.destino === monedaAnticipo,
        'TASA_REQUERIDA',
        `Falta la tasa ${datos.total.moneda}->${monedaAnticipo}`,
      );
    }
  }

  private alertasDeFecha(fecha: FechaCalendario): Alerta[] {
    const { inicio, fin } = this.props.viaje;
    const fuera = fecha.esAnteriorA(inicio.sumarDias(-MARGEN_DIAS_VIAJE)) || fecha.esPosteriorA(fin.sumarDias(MARGEN_DIAS_VIAJE));
    return fuera
      ? [{ codigo: 'FECHA_FUERA_DEL_VIAJE', severidad: 'REVISION', mensaje: `La fecha ${fecha} está fuera del viaje (${inicio} a ${fin})` }]
      : [];
  }

  private exigirEditable(): void {
    if (this.props.estado !== 'ABIERTA' && this.props.estado !== 'DEVUELTA') {
      throw new DomainError('LEGALIZACION_NO_EDITABLE', 'CONFLICTO', `La legalización está ${this.props.estado}`, {
        estado: this.props.estado,
      });
    }
  }

  private exigirEstado(estado: EstadoLegalizacion): void {
    if (this.props.estado !== estado) {
      throw new DomainError('ESTADO_LEGALIZACION_INVALIDO', 'CONFLICTO', `La legalización está ${this.props.estado}`, {
        estado: this.props.estado,
      });
    }
  }

  private exigirNoEsViajero(usuarioId: string): void {
    if (usuarioId === this.props.viajeroId) {
      throw new DomainError('AUTORREVISION_NO_PERMITIDA', 'NO_AUTORIZADO', 'Nadie puede revisar su propia legalización');
    }
  }

  private agregarHistorial(tipo: EventoHistorial['tipo'], usuarioId: string, comentario: string | null, ahora: Date) {
    this.props.historial.push({ tipo, usuarioId, comentario, en: ahora });
    this.tocar(ahora);
  }

  private tocar(ahora: Date): void {
    this.props.actualizadaEn = ahora;
  }
}

export const requiereDecision = (s: Soporte) => s.alertas.some((a) => a.severidad === 'REVISION');

/**
 * Montos de un soporte en la moneda del anticipo.
 * Aceptado = total − líneas excluidas (impuestos y propinas no siempre vienen por línea).
 * Si contabilidad decidió que no aplica, todo el total queda excluido.
 */
export function montosDelSoporte(s: Soporte, monedaAnticipo: string): { aceptado: Money; excluido: Money } {
  const cero = { aceptado: Money.cero(monedaAnticipo), excluido: Money.cero(monedaAnticipo) };
  if (s.estado !== 'CONFIRMADO' || !s.datos) return cero;
  const { total, lineas, tasa } = s.datos;
  const aMonedaAnticipo = (m: Money) => (m.moneda === monedaAnticipo ? m : m.convertir(tasa!));

  if (s.decision && !s.decision.aplica) return { aceptado: cero.aceptado, excluido: aMonedaAnticipo(total) };

  const excluidoLineas = Money.sumarTodos(
    lineas.filter((l) => l.excluida).map((l) => l.valor),
    total.moneda,
  );
  const aceptado = total.restar(excluidoLineas);
  return {
    aceptado: aMonedaAnticipo(aceptado.esNegativo() ? Money.cero(total.moneda) : aceptado),
    excluido: aMonedaAnticipo(excluidoLineas),
  };
}

function alertasDeLineas(lineas: readonly LineaSoporte[], total: Money): Alerta[] {
  const alertas: Alerta[] = [];
  const excluidas = lineas.filter((l) => l.excluida);
  if (excluidas.length) {
    const motivos = [...new Set(excluidas.map((l) => l.motivoExclusion))].join(', ');
    alertas.push({
      codigo: 'LINEAS_EXCLUIDAS',
      severidad: 'INFO',
      mensaje: `${excluidas.length} línea(s) excluida(s) por política: ${motivos}. Quedan a cargo del viajero`,
    });
  }
  if (lineas.length) {
    const suma = Money.sumarTodos(
      lineas.map((l) => l.valor),
      total.moneda,
    );
    if (!suma.equals(total)) {
      alertas.push({
        codigo: 'TOTAL_NO_CUADRA',
        severidad: 'INFO',
        mensaje: `La suma de las líneas (${suma}) no coincide con el total (${total}); puede incluir impuestos o propina`,
      });
    }
  }
  return alertas;
}
