import type { PresupuestoViaje } from '../presupuesto-viaje';

export interface MotivoEscalamiento {
  /** Código estable para i18n en el cliente. */
  codigo: string;
  descripcion: string;
  detalles: Record<string, unknown>;
}

/** Regla que decide si un presupuesto requiere aprobación del jefe directivo. */
export interface ReglaEscalamiento {
  evaluar(presupuesto: PresupuestoViaje): MotivoEscalamiento[];
}

export interface ResultadoEscalamiento {
  requiereJefeDirectivo: boolean;
  motivos: MotivoEscalamiento[];
}

export function evaluarEscalamiento(
  presupuesto: PresupuestoViaje,
  reglas: readonly ReglaEscalamiento[],
): ResultadoEscalamiento {
  const motivos = reglas.flatMap((regla) => regla.evaluar(presupuesto));
  return { requiereJefeDirectivo: motivos.length > 0, motivos };
}
