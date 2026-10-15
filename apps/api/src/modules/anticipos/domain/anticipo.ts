import { DomainError, FechaCalendario, invariante, type Money, type MoneyDto } from '@viaticos/shared-kernel';
import { AgregadoRaiz, type EventoDominio } from '../../../shared/domain/agregado-raiz';

/**
 * PENDIENTE_ERP   → creado aquí, falta registrarlo en Siesa (o falló y se reintenta)
 * POR_DESEMBOLSAR → registrado en el ERP, esperando el pago de tesorería
 * DESEMBOLSADO    → el viajero recibió el dinero y puede legalizar
 * LEGALIZADO      → la legalización fue aprobada por contabilidad
 */
export type EstadoAnticipo = 'PENDIENTE_ERP' | 'POR_DESEMBOLSAR' | 'DESEMBOLSADO' | 'LEGALIZADO';
export type MedioDesembolso = 'TRANSFERENCIA' | 'EFECTIVO' | 'TARJETA_DEBITO';

export interface ViajeAnticipo {
  motivo: string;
  destinos: ReadonlyArray<{ paisCodigo: string; ciudad: string; fechaInicio: string; fechaFin: string }>;
}

export interface Desembolso {
  fecha: FechaCalendario;
  medio: MedioDesembolso;
  referencia: string | null;
  registradoPor: string;
  registradoEn: Date;
}

export interface EstadoErp {
  referencia: string | null;
  ultimoError: string | null;
  intentos: number;
}

export interface AnticipoProps {
  id: string;
  solicitudId: string;
  viajeroId: string;
  monto: Money;
  viaje: ViajeAnticipo;
  estado: EstadoAnticipo;
  erp: EstadoErp;
  desembolso: Desembolso | null;
  creadoEn: Date;
  actualizadoEn: Date;
  version: number;
}

export interface AnticipoDesembolsado extends EventoDominio {
  tipo: 'anticipos.AnticipoDesembolsado';
  viajeroId: string;
  monto: MoneyDto;
  viajeInicio: string;
  viajeFin: string;
}

export class Anticipo extends AgregadoRaiz {
  private constructor(private props: AnticipoProps) {
    super();
  }

  static crearDesdeSolicitud(datos: {
    id: string;
    solicitudId: string;
    viajeroId: string;
    monto: Money;
    viaje: ViajeAnticipo;
    ahora: Date;
  }): Anticipo {
    invariante(!datos.monto.esCero() && !datos.monto.esNegativo(), 'MONTO_INVALIDO', 'El anticipo debe ser mayor que cero');
    invariante(datos.viaje.destinos.length > 0, 'VIAJE_SIN_DESTINOS', 'El anticipo necesita los destinos del viaje');
    return new Anticipo({
      ...datos,
      estado: 'PENDIENTE_ERP',
      erp: { referencia: null, ultimoError: null, intentos: 0 },
      desembolso: null,
      creadoEn: datos.ahora,
      actualizadoEn: datos.ahora,
      version: 0,
    });
  }

  static rehidratar(props: AnticipoProps): Anticipo {
    return new Anticipo(props);
  }

  get id() {
    return this.props.id;
  }
  get solicitudId() {
    return this.props.solicitudId;
  }
  get viajeroId() {
    return this.props.viajeroId;
  }
  get monto() {
    return this.props.monto;
  }
  get viaje() {
    return this.props.viaje;
  }
  get estado() {
    return this.props.estado;
  }
  get erp(): Readonly<EstadoErp> {
    return this.props.erp;
  }
  get desembolso(): Readonly<Desembolso> | null {
    return this.props.desembolso;
  }
  get creadoEn() {
    return this.props.creadoEn;
  }
  get version() {
    return this.props.version;
  }

  /** Primer y último día del viaje (para validar fechas de facturas). */
  get rangoViaje(): { inicio: FechaCalendario; fin: FechaCalendario } {
    const inicios = this.props.viaje.destinos.map((d) => FechaCalendario.of(d.fechaInicio));
    const fines = this.props.viaje.destinos.map((d) => FechaCalendario.of(d.fechaFin));
    return {
      inicio: inicios.reduce((a, b) => (b.esAnteriorA(a) ? b : a)),
      fin: fines.reduce((a, b) => (b.esPosteriorA(a) ? b : a)),
    };
  }

  registradoEnErp(referencia: string, ahora: Date): void {
    this.exigirEstado('PENDIENTE_ERP');
    this.props.erp = { referencia, ultimoError: null, intentos: this.props.erp.intentos + 1 };
    this.props.estado = 'POR_DESEMBOLSAR';
    this.props.actualizadoEn = ahora;
  }

  falloRegistroErp(mensaje: string, ahora: Date): void {
    this.exigirEstado('PENDIENTE_ERP');
    this.props.erp = { ...this.props.erp, ultimoError: mensaje.slice(0, 500), intentos: this.props.erp.intentos + 1 };
    this.props.actualizadoEn = ahora;
  }

  registrarDesembolso(datos: {
    fecha: FechaCalendario;
    medio: MedioDesembolso;
    referencia: string | null;
    tesoreroId: string;
    ahora: Date;
  }): void {
    this.exigirEstado('POR_DESEMBOLSAR');
    if (datos.tesoreroId === this.props.viajeroId) {
      throw new DomainError('AUTODESEMBOLSO_NO_PERMITIDO', 'REGLA_NEGOCIO', 'Nadie puede registrar el desembolso de su propio anticipo');
    }
    // Un día de margen por la diferencia entre UTC y la hora de Colombia.
    if (datos.fecha.esPosteriorA(FechaCalendario.of(datos.ahora.toISOString().slice(0, 10)).sumarDias(1))) {
      throw new DomainError('FECHA_FUTURA', 'VALIDACION', 'La fecha del desembolso no puede ser futura');
    }
    this.props.desembolso = {
      fecha: datos.fecha,
      medio: datos.medio,
      referencia: datos.referencia?.trim() || null,
      registradoPor: datos.tesoreroId,
      registradoEn: datos.ahora,
    };
    this.props.estado = 'DESEMBOLSADO';
    this.props.actualizadoEn = datos.ahora;
    this.registrarEvento({
      tipo: 'anticipos.AnticipoDesembolsado',
      agregadoId: this.id,
      ocurridoEn: datos.ahora,
      viajeroId: this.viajeroId,
      monto: this.monto.toDto(),
      viajeInicio: this.rangoViaje.inicio.toString(),
      viajeFin: this.rangoViaje.fin.toString(),
    } satisfies AnticipoDesembolsado);
  }

  marcarLegalizado(ahora: Date): void {
    this.exigirEstado('DESEMBOLSADO');
    this.props.estado = 'LEGALIZADO';
    this.props.actualizadoEn = ahora;
  }

  toSnapshot(): AnticipoProps {
    return { ...this.props, erp: { ...this.props.erp }, desembolso: this.props.desembolso && { ...this.props.desembolso } };
  }

  private exigirEstado(esperado: EstadoAnticipo): void {
    if (this.props.estado !== esperado) {
      throw new DomainError('ESTADO_ANTICIPO_INVALIDO', 'CONFLICTO', `El anticipo está ${this.props.estado}`, {
        estado: this.props.estado,
        esperado,
      });
    }
  }
}

export interface AnticipoRepository {
  /** Inserta o actualiza con concurrencia optimista (CONFLICTO si cambió la versión). */
  guardar(anticipo: Anticipo): Promise<void>;
  obtenerPorId(id: string): Promise<Anticipo | null>;
  obtenerPorSolicitud(solicitudId: string): Promise<Anticipo | null>;
  listarPorViajero(viajeroId: string): Promise<Anticipo[]>;
  listarPorEstados(estados: readonly EstadoAnticipo[]): Promise<Anticipo[]>;
}
