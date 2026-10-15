import { DomainError } from '@viaticos/shared-kernel';

export type NivelAprobacion = 'JEFE_INMEDIATO' | 'JEFE_DIRECTIVO';
export type EstadoPaso = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';

export interface PasoAprobacion {
  orden: number;
  nivel: NivelAprobacion;
  aprobadorId: string;
  estado: EstadoPaso;
  decididoEn: Date | null;
  comentario: string | null;
}

export interface AprobadoresViajero {
  viajeroId: string;
  jefeInmediatoId: string | null;
  jefeDirectivoId: string | null;
}

/** Pasos secuenciales de aprobación de una solicitud. */
export class RutaAprobacion {
  private constructor(private readonly pasos: PasoAprobacion[]) {}

  static construir(aprobadores: AprobadoresViajero, requiereJefeDirectivo: boolean): RutaAprobacion {
    const { viajeroId, jefeInmediatoId, jefeDirectivoId } = aprobadores;
    if (!jefeInmediatoId) {
      throw new DomainError('SIN_JEFE_INMEDIATO', 'REGLA_NEGOCIO', 'El viajero no tiene jefe inmediato asignado');
    }
    if (requiereJefeDirectivo && !jefeDirectivoId) {
      throw new DomainError('SIN_JEFE_DIRECTIVO', 'REGLA_NEGOCIO', 'El viajero no tiene jefe directivo asignado');
    }
    if (jefeInmediatoId === viajeroId || (requiereJefeDirectivo && jefeDirectivoId === viajeroId)) {
      throw new DomainError('AUTOAPROBACION_NO_PERMITIDA', 'REGLA_NEGOCIO', 'Nadie puede aprobar su propio viaje');
    }

    const niveles: Array<[NivelAprobacion, string]> = [];
    if (!requiereJefeDirectivo) {
      niveles.push(['JEFE_INMEDIATO', jefeInmediatoId]);
    } else if (jefeDirectivoId === jefeInmediatoId) {
      // La misma persona aprueba una sola vez, en el nivel más alto.
      niveles.push(['JEFE_DIRECTIVO', jefeDirectivoId!]);
    } else {
      niveles.push(['JEFE_INMEDIATO', jefeInmediatoId], ['JEFE_DIRECTIVO', jefeDirectivoId!]);
    }

    return new RutaAprobacion(
      niveles.map(([nivel, aprobadorId], i) => ({
        orden: i + 1,
        nivel,
        aprobadorId,
        estado: 'PENDIENTE',
        decididoEn: null,
        comentario: null,
      })),
    );
  }

  static rehidratar(pasos: readonly PasoAprobacion[]): RutaAprobacion {
    return new RutaAprobacion(pasos.map((p) => ({ ...p })));
  }

  get pasosSnapshot(): PasoAprobacion[] {
    return this.pasos.map((p) => ({ ...p }));
  }

  pasoActual(): PasoAprobacion | null {
    if (this.pasos.some((p) => p.estado === 'RECHAZADO')) return null;
    return this.pasos.find((p) => p.estado === 'PENDIENTE') ?? null;
  }

  estaCompleta(): boolean {
    return this.pasos.every((p) => p.estado === 'APROBADO');
  }

  esAprobadorActual(usuarioId: string): boolean {
    return this.pasoActual()?.aprobadorId === usuarioId;
  }

  participa(usuarioId: string): boolean {
    return this.pasos.some((p) => p.aprobadorId === usuarioId);
  }

  aprobar(aprobadorId: string, ahora: Date, comentario: string | null): void {
    const paso = this.exigirPasoDe(aprobadorId);
    paso.estado = 'APROBADO';
    paso.decididoEn = ahora;
    paso.comentario = comentario;
  }

  rechazar(aprobadorId: string, ahora: Date, comentario: string): void {
    if (comentario.trim().length < 5) {
      throw new DomainError('COMENTARIO_REQUERIDO', 'VALIDACION', 'El rechazo debe explicar el motivo');
    }
    const paso = this.exigirPasoDe(aprobadorId);
    paso.estado = 'RECHAZADO';
    paso.decididoEn = ahora;
    paso.comentario = comentario.trim();
  }

  private exigirPasoDe(aprobadorId: string): PasoAprobacion {
    const paso = this.pasoActual();
    if (!paso) throw new DomainError('RUTA_FINALIZADA', 'CONFLICTO', 'La solicitud no tiene aprobaciones pendientes');
    if (paso.aprobadorId !== aprobadorId) {
      throw new DomainError('NO_ES_APROBADOR_ACTUAL', 'NO_AUTORIZADO', 'No le corresponde aprobar este paso');
    }
    return paso;
  }
}
