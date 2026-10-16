import { DomainError, type FechaCalendario, type Money } from '@viaticos/shared-kernel';
import { AgregadoRaiz } from '../../../shared/domain/agregado-raiz';
import { clavePar, type Propuesta } from './conciliador';
import type { MovimientoLeido, PerfilExtracto } from './perfil-extracto';

export interface MovimientoBancario extends MovimientoLeido {
  id: string;
}

/**
 * AUTOMATICO / SUGERIDO: los propone el sistema y se recalculan.
 * CONFIRMADO / MANUAL: los decidió contabilidad; el recálculo no los toca.
 */
export type EstadoCruce = 'AUTOMATICO' | 'SUGERIDO' | 'CONFIRMADO' | 'MANUAL';

export interface Cruce {
  movimientoId: string;
  soporteId: string;
  legalizacionId: string;
  puntaje: number | null;
  estado: EstadoCruce;
  /** Total de la factura en la moneda del extracto (para ver la diferencia). */
  montoSoporte: Money | null;
  decididoPor: string | null;
  decididoEn: Date | null;
}

export interface ExtractoProps {
  id: string;
  /** Dueño de la tarjeta (el viajero). */
  titularId: string;
  /** Legalización desde la que se cargó. */
  legalizacionId: string;
  ultimos4: string | null;
  moneda: string;
  archivo: { nombre: string; sha256: string };
  perfil: PerfilExtracto;
  movimientos: MovimientoBancario[];
  cruces: Cruce[];
  rechazos: Array<{ movimientoId: string; soporteId: string }>;
  /** Cargos sin factura: contabilidad decide si se descuentan al viajero. */
  decisionesCargos: DecisionCargo[];
  cargadoPor: string;
  cargadoEn: Date;
  actualizadoEn: Date;
  version: number;
}

export interface DecisionCargo {
  movimientoId: string;
  descontar: boolean;
  decididoPor: string;
  decididoEn: Date;
}

export class Extracto extends AgregadoRaiz {
  private constructor(private props: ExtractoProps) {
    super();
  }

  static cargar(datos: Omit<ExtractoProps, 'cruces' | 'rechazos' | 'decisionesCargos' | 'actualizadoEn' | 'version'>): Extracto {
    if (datos.ultimos4 !== null && !/^\d{4}$/.test(datos.ultimos4)) {
      throw new DomainError('ULTIMOS4_INVALIDOS', 'VALIDACION', 'Los últimos 4 dígitos de la tarjeta deben ser 4 números');
    }
    if (!datos.movimientos.some((m) => m.tipo === 'DEBITO')) {
      throw new DomainError('EXTRACTO_SIN_CARGOS', 'REGLA_NEGOCIO', 'El extracto no tiene cargos: revise el mapeo de columnas');
    }
    if (datos.movimientos.some((m) => m.valor.moneda !== datos.moneda)) {
      throw new DomainError('MONEDA_INCONSISTENTE', 'VALIDACION', 'Todos los movimientos deben estar en la moneda del extracto');
    }
    return new Extracto({ ...datos, cruces: [], rechazos: [], decisionesCargos: [], actualizadoEn: datos.cargadoEn, version: 0 });
  }

  static rehidratar(props: ExtractoProps): Extracto {
    return new Extracto(props);
  }

  get id() {
    return this.props.id;
  }
  get titularId() {
    return this.props.titularId;
  }
  get legalizacionId() {
    return this.props.legalizacionId;
  }
  get ultimos4() {
    return this.props.ultimos4;
  }
  get moneda() {
    return this.props.moneda;
  }
  get movimientos(): readonly MovimientoBancario[] {
    return this.props.movimientos;
  }
  get cargos(): readonly MovimientoBancario[] {
    return this.props.movimientos.filter((m) => m.tipo === 'DEBITO');
  }
  get cruces(): readonly Cruce[] {
    return this.props.cruces;
  }
  get version() {
    return this.props.version;
  }
  get decisionesCargos(): readonly DecisionCargo[] {
    return this.props.decisionesCargos;
  }

  /** Cargos sin factura (sin cruce). */
  cargosSinSoporte(): MovimientoBancario[] {
    const cruzados = new Set(this.props.cruces.map((c) => c.movimientoId));
    return this.cargos.filter((m) => !cruzados.has(m.id));
  }

  /** Contabilidad decide si un cargo sin factura se descuenta al viajero. */
  decidirCargo(movimientoId: string, descontar: boolean, usuarioId: string, ahora: Date): MovimientoBancario {
    const cargo = this.cargosSinSoporte().find((m) => m.id === movimientoId);
    if (!cargo) throw new DomainError('CARGO_NO_DECIDIBLE', 'REGLA_NEGOCIO', 'Solo se decide sobre cargos sin factura');
    this.props.decisionesCargos = [
      ...this.props.decisionesCargos.filter((d) => d.movimientoId !== movimientoId),
      { movimientoId, descontar, decididoPor: usuarioId, decididoEn: ahora },
    ];
    this.props.actualizadoEn = ahora;
    return cargo;
  }

  /** Primer y último día con movimientos. */
  periodo(): { desde: FechaCalendario; hasta: FechaCalendario } {
    const fechas = [...this.props.movimientos].map((m) => m.fecha).sort((a, b) => a.diasHasta(b) * -1);
    return { desde: fechas[0]!, hasta: fechas[fechas.length - 1]! };
  }

  paresRechazados(): Set<string> {
    return new Set(this.props.rechazos.map((r) => clavePar(r.movimientoId, r.soporteId)));
  }

  /** Cruces que el recálculo debe respetar. */
  crucesFijos(): Cruce[] {
    return this.props.cruces.filter((c) => c.estado === 'CONFIRMADO' || c.estado === 'MANUAL');
  }

  /** Reemplaza las propuestas automáticas; las decisiones de contabilidad se conservan. */
  aplicarPropuestas(propuestas: readonly Propuesta[], ahora: Date): void {
    const fijos = this.crucesFijos();
    const movimientosFijos = new Set(fijos.map((c) => c.movimientoId));
    const soportesFijos = new Set(fijos.map((c) => c.soporteId));
    const nuevas = propuestas
      .filter((p) => !movimientosFijos.has(p.movimientoId) && !soportesFijos.has(p.soporteId))
      .map<Cruce>((p) => ({ ...p, decididoPor: null, decididoEn: null }));
    this.props.cruces = [...fijos, ...nuevas];
    this.quitarDecisionesDeCruzados();
    this.props.actualizadoEn = ahora;
  }

  confirmar(movimientoId: string, usuarioId: string, ahora: Date): void {
    const cruce = this.cruceDe(movimientoId);
    cruce.estado = cruce.estado === 'MANUAL' ? 'MANUAL' : 'CONFIRMADO';
    cruce.decididoPor = usuarioId;
    cruce.decididoEn = ahora;
    this.props.actualizadoEn = ahora;
  }

  /** Deshace el cruce y evita que el sistema vuelva a proponer ese mismo par. */
  rechazar(movimientoId: string, ahora: Date): void {
    const cruce = this.cruceDe(movimientoId);
    this.props.cruces = this.props.cruces.filter((c) => c !== cruce);
    this.props.rechazos.push({ movimientoId, soporteId: cruce.soporteId });
    this.props.actualizadoEn = ahora;
  }

  enlazar(
    movimientoId: string,
    pago: { soporteId: string; legalizacionId: string; montoSoporte: Money | null },
    usuarioId: string,
    ahora: Date,
  ): void {
    const movimiento = this.props.movimientos.find((m) => m.id === movimientoId);
    if (!movimiento) throw new DomainError('MOVIMIENTO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El movimiento no existe en este extracto');
    if (movimiento.tipo !== 'DEBITO') throw new DomainError('MOVIMIENTO_NO_ES_CARGO', 'REGLA_NEGOCIO', 'Solo los cargos se cruzan con facturas');
    const fijo = this.props.cruces.find((c) => c.movimientoId === movimientoId && (c.estado === 'CONFIRMADO' || c.estado === 'MANUAL'));
    if (fijo) throw new DomainError('MOVIMIENTO_YA_CRUZADO', 'REGLA_NEGOCIO', 'Ese cargo ya está cruzado; deshaga el cruce primero');
    // Una propuesta automática sobre el mismo cargo o la misma factura cede ante la decisión manual.
    this.props.cruces = this.props.cruces.filter((c) => c.movimientoId !== movimientoId && c.soporteId !== pago.soporteId);
    this.props.cruces.push({ movimientoId, ...pago, puntaje: null, estado: 'MANUAL', decididoPor: usuarioId, decididoEn: ahora });
    this.quitarDecisionesDeCruzados();
    this.props.rechazos = this.props.rechazos.filter((r) => !(r.movimientoId === movimientoId && r.soporteId === pago.soporteId));
    this.props.actualizadoEn = ahora;
  }

  toSnapshot(): ExtractoProps {
    return { ...this.props };
  }

  private quitarDecisionesDeCruzados(): void {
    const cruzados = new Set(this.props.cruces.map((c) => c.movimientoId));
    this.props.decisionesCargos = this.props.decisionesCargos.filter((d) => !cruzados.has(d.movimientoId));
  }

  private cruceDe(movimientoId: string): Cruce {
    const cruce = this.props.cruces.find((c) => c.movimientoId === movimientoId);
    if (!cruce) throw new DomainError('CRUCE_NO_ENCONTRADO', 'NO_ENCONTRADO', 'Ese cargo no tiene un cruce');
    return cruce;
  }
}

export interface ExtractoRepository {
  guardar(extracto: Extracto): Promise<void>;
  obtenerPorId(id: string): Promise<Extracto | null>;
  existeArchivo(sha256: string): Promise<boolean>;
  listarPorTitular(titularId: string): Promise<Extracto[]>;
  listarRecientes(limite: number): Promise<Extracto[]>;
  /** Facturas ya cruzadas en otros extractos (una factura se paga una sola vez). */
  soportesCruzadosFuera(extractoId: string, soporteIds: readonly string[]): Promise<Set<string>>;
}

export interface PerfilGuardado {
  id: string;
  nombre: string;
  perfil: PerfilExtracto;
  actualizadoPor: string;
  actualizadoEn: Date;
}

export interface PerfilExtractoRepository {
  listar(): Promise<PerfilGuardado[]>;
  /** Inserta o reemplaza por nombre. */
  guardar(perfil: PerfilGuardado): Promise<void>;
}
