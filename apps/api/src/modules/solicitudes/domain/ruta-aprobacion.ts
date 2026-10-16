import { DomainError } from '@viaticos/shared-kernel';

export type NivelAprobacion = 'JEFE_INMEDIATO' | 'JEFE_DIRECTIVO' | 'GERENCIA';
/** OMITIDO: el nivel superior aprobó antes y este paso ya no hace falta. */
export type EstadoPaso = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'OMITIDO';

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
  /** Quien aprueba los viajes de directivos y gerencia (o cuando falta el jefe directivo). */
  gerenciaId?: string | null;
}

const NIVELES_SUPERIORES: readonly NivelAprobacion[] = ['JEFE_DIRECTIVO', 'GERENCIA'];

/**
 * Pasos de aprobación de una solicitud. El jefe inmediato aprueba primero, pero el
 * nivel superior (directivo o gerencia) puede aprobar sin esperarlo: su decisión
 * completa la ruta.
 */
export class RutaAprobacion {
  private constructor(private readonly pasos: PasoAprobacion[]) {}

  static construir(aprobadores: AprobadoresViajero, requiereJefeDirectivo: boolean): RutaAprobacion {
    const { viajeroId, jefeInmediatoId, jefeDirectivoId } = aprobadores;
    const gerenciaId = aprobadores.gerenciaId && aprobadores.gerenciaId !== viajeroId ? aprobadores.gerenciaId : null;
    const exigirGerencia = (): string => {
      if (!gerenciaId) {
        throw new DomainError('SIN_APROBADOR', 'REGLA_NEGOCIO', 'No hay quién apruebe este viaje: asigne el jefe o un usuario de gerencia');
      }
      return gerenciaId;
    };

    const niveles: Array<[NivelAprobacion, string]> = [];
    if (!jefeInmediatoId || jefeInmediatoId === viajeroId) {
      // Directivos y gerencia no tienen jefe inmediato: aprueba la gerencia.
      niveles.push(['GERENCIA', exigirGerencia()]);
    } else if (!requiereJefeDirectivo) {
      niveles.push(['JEFE_INMEDIATO', jefeInmediatoId]);
    } else {
      const superior: [NivelAprobacion, string] =
        jefeDirectivoId && jefeDirectivoId !== viajeroId ? ['JEFE_DIRECTIVO', jefeDirectivoId] : ['GERENCIA', exigirGerencia()];
      // La misma persona aprueba una sola vez, en el nivel más alto.
      if (superior[1] !== jefeInmediatoId) niveles.push(['JEFE_INMEDIATO', jefeInmediatoId]);
      niveles.push(superior);
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

  /** El primer paso pendiente (el turno normal), o null si la ruta terminó. */
  pasoActual(): PasoAprobacion | null {
    if (this.pasos.some((p) => p.estado === 'RECHAZADO')) return null;
    return this.pasos.find((p) => p.estado === 'PENDIENTE') ?? null;
  }

  /** Pasos que pueden decidirse ya: el turno normal y el nivel superior pendiente. */
  pasosDecidibles(): PasoAprobacion[] {
    const actual = this.pasoActual();
    if (!actual) return [];
    const superior = this.pasos.find((p) => p.estado === 'PENDIENTE' && NIVELES_SUPERIORES.includes(p.nivel));
    return superior && superior !== actual ? [actual, superior] : [actual];
  }

  estaCompleta(): boolean {
    return this.pasos.every((p) => p.estado === 'APROBADO' || p.estado === 'OMITIDO');
  }

  esAprobadorActual(usuarioId: string): boolean {
    return this.pasosDecidibles().some((p) => p.aprobadorId === usuarioId);
  }

  participa(usuarioId: string): boolean {
    return this.pasos.some((p) => p.aprobadorId === usuarioId);
  }

  aprobar(aprobadorId: string, ahora: Date, comentario: string | null): void {
    const paso = this.exigirPasoDe(aprobadorId);
    paso.estado = 'APROBADO';
    paso.decididoEn = ahora;
    paso.comentario = comentario;
    if (NIVELES_SUPERIORES.includes(paso.nivel)) {
      for (const previo of this.pasos) {
        if (previo.estado === 'PENDIENTE' && previo.orden < paso.orden) {
          previo.estado = 'OMITIDO';
          previo.decididoEn = ahora;
        }
      }
    }
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
    const decidibles = this.pasosDecidibles();
    if (decidibles.length === 0) throw new DomainError('RUTA_FINALIZADA', 'CONFLICTO', 'La solicitud no tiene aprobaciones pendientes');
    // Si la misma persona está en ambos, decide en el nivel más alto.
    const paso = [...decidibles].reverse().find((p) => p.aprobadorId === aprobadorId);
    if (!paso) throw new DomainError('NO_ES_APROBADOR_ACTUAL', 'NO_AUTORIZADO', 'No le corresponde aprobar este paso');
    return paso;
  }
}
