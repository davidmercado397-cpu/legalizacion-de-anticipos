import { DomainError, invariante } from '@viaticos/shared-kernel';
import { AgregadoRaiz } from '../../../shared/domain/agregado-raiz';
import type { Destino } from './destino';
import type {
  AprobacionRegistrada,
  SolicitudAprobada,
  SolicitudCancelada,
  SolicitudEnviada,
  SolicitudRechazada,
} from './eventos';
import type { PresupuestoViaje } from './presupuesto-viaje';
import type { ResultadoEscalamiento } from './escalamiento/regla-escalamiento';
import { RutaAprobacion, type AprobadoresViajero } from './ruta-aprobacion';

export type EstadoSolicitud = 'EN_APROBACION' | 'APROBADA' | 'RECHAZADA' | 'CANCELADA';

export interface SolicitudViajeProps {
  id: string;
  viajeroId: string;
  motivo: string;
  justificacion: string | null;
  destinos: readonly Destino[];
  presupuesto: PresupuestoViaje;
  escalamiento: ResultadoEscalamiento;
  ruta: RutaAprobacion;
  estado: EstadoSolicitud;
  creadaEn: Date;
  actualizadaEn: Date;
  /** Control de concurrencia optimista. */
  version: number;
}

export interface CrearSolicitudProps {
  id: string;
  aprobadores: AprobadoresViajero;
  motivo: string;
  justificacion: string | null;
  destinos: readonly Destino[];
  presupuesto: PresupuestoViaje;
  escalamiento: ResultadoEscalamiento;
  ahora: Date;
}

/** Raíz del agregado: la solicitud de viaje y su ciclo de aprobación. */
export class SolicitudViaje extends AgregadoRaiz {
  private constructor(private props: SolicitudViajeProps) {
    super();
  }

  static crear(datos: CrearSolicitudProps): SolicitudViaje {
    const motivo = datos.motivo.trim();
    const justificacion = datos.justificacion?.trim() || null;
    invariante(motivo.length >= 10, 'MOTIVO_REQUERIDO', 'Describa el motivo del viaje (mínimo 10 caracteres)');
    invariante(datos.destinos.length > 0, 'DESTINO_REQUERIDO', 'La solicitud necesita al menos un destino');
    if (datos.escalamiento.requiereJefeDirectivo && !justificacion) {
      throw new DomainError(
        'JUSTIFICACION_REQUERIDA',
        'VALIDACION',
        'La solicitud requiere aprobación directiva: justifique por qué supera la política',
        { motivos: datos.escalamiento.motivos.map((m) => m.codigo) },
      );
    }

    const ruta = RutaAprobacion.construir(datos.aprobadores, datos.escalamiento.requiereJefeDirectivo);
    const solicitud = new SolicitudViaje({
      id: datos.id,
      viajeroId: datos.aprobadores.viajeroId,
      motivo,
      justificacion,
      destinos: [...datos.destinos],
      presupuesto: datos.presupuesto,
      escalamiento: datos.escalamiento,
      ruta,
      estado: 'EN_APROBACION',
      creadaEn: datos.ahora,
      actualizadaEn: datos.ahora,
      version: 0,
    });

    solicitud.registrarEvento({
      tipo: 'solicitudes.SolicitudEnviada',
      agregadoId: datos.id,
      ocurridoEn: datos.ahora,
      viajeroId: solicitud.viajeroId,
      aprobadorId: ruta.pasoActual()!.aprobadorId,
      requiereJefeDirectivo: datos.escalamiento.requiereJefeDirectivo,
    } satisfies SolicitudEnviada);
    return solicitud;
  }

  static rehidratar(props: SolicitudViajeProps): SolicitudViaje {
    return new SolicitudViaje(props);
  }

  get id(): string {
    return this.props.id;
  }
  get viajeroId(): string {
    return this.props.viajeroId;
  }
  get motivo(): string {
    return this.props.motivo;
  }
  get justificacion(): string | null {
    return this.props.justificacion;
  }
  get destinos(): readonly Destino[] {
    return this.props.destinos;
  }
  get presupuesto(): PresupuestoViaje {
    return this.props.presupuesto;
  }
  get escalamiento(): ResultadoEscalamiento {
    return this.props.escalamiento;
  }
  get ruta(): RutaAprobacion {
    return this.props.ruta;
  }
  get estado(): EstadoSolicitud {
    return this.props.estado;
  }
  get creadaEn(): Date {
    return this.props.creadaEn;
  }
  get actualizadaEn(): Date {
    return this.props.actualizadaEn;
  }
  get version(): number {
    return this.props.version;
  }

  aprobar(aprobadorId: string, ahora: Date, comentario: string | null = null): void {
    this.exigirEnAprobacion();
    this.props.ruta.aprobar(aprobadorId, ahora, comentario?.trim() || null);
    this.tocar(ahora);

    const siguiente = this.props.ruta.pasoActual();
    this.registrarEvento({
      tipo: 'solicitudes.AprobacionRegistrada',
      agregadoId: this.id,
      ocurridoEn: ahora,
      aprobadorId,
      siguienteAprobadorId: siguiente?.aprobadorId ?? null,
    } satisfies AprobacionRegistrada);

    if (this.props.ruta.estaCompleta()) {
      this.props.estado = 'APROBADA';
      this.registrarEvento({
        tipo: 'solicitudes.SolicitudAprobada',
        agregadoId: this.id,
        ocurridoEn: ahora,
        viajeroId: this.viajeroId,
        totalAnticipo: this.presupuesto.totalAnticipo.toDto(),
        motivo: this.motivo,
        destinos: this.destinos.map((d) => d.toDatos()),
      } satisfies SolicitudAprobada);
    }
  }

  rechazar(aprobadorId: string, ahora: Date, comentario: string): void {
    this.exigirEnAprobacion();
    this.props.ruta.rechazar(aprobadorId, ahora, comentario);
    this.props.estado = 'RECHAZADA';
    this.tocar(ahora);
    this.registrarEvento({
      tipo: 'solicitudes.SolicitudRechazada',
      agregadoId: this.id,
      ocurridoEn: ahora,
      viajeroId: this.viajeroId,
      aprobadorId,
      comentario: comentario.trim(),
    } satisfies SolicitudRechazada);
  }

  cancelar(usuarioId: string, ahora: Date): void {
    if (usuarioId !== this.viajeroId) {
      throw new DomainError('SOLO_EL_VIAJERO_CANCELA', 'NO_AUTORIZADO', 'Solo el viajero puede cancelar su solicitud');
    }
    this.exigirEnAprobacion();
    this.props.estado = 'CANCELADA';
    this.tocar(ahora);
    this.registrarEvento({
      tipo: 'solicitudes.SolicitudCancelada',
      agregadoId: this.id,
      ocurridoEn: ahora,
      viajeroId: this.viajeroId,
    } satisfies SolicitudCancelada);
  }

  /** Copia de los datos para persistencia (los repositorios no comparten referencias mutables). */
  toSnapshot(): SolicitudViajeProps {
    return {
      ...this.props,
      destinos: [...this.props.destinos],
      escalamiento: { ...this.props.escalamiento, motivos: [...this.props.escalamiento.motivos] },
      ruta: RutaAprobacion.rehidratar(this.props.ruta.pasosSnapshot),
    };
  }

  puedeSerVistaPor(usuarioId: string): boolean {
    return usuarioId === this.viajeroId || this.props.ruta.participa(usuarioId);
  }

  private exigirEnAprobacion(): void {
    if (this.props.estado !== 'EN_APROBACION') {
      throw new DomainError('SOLICITUD_NO_PENDIENTE', 'CONFLICTO', `La solicitud está ${this.props.estado}`, {
        estado: this.props.estado,
      });
    }
  }

  private tocar(ahora: Date): void {
    this.props.actualizadaEn = ahora;
  }
}
