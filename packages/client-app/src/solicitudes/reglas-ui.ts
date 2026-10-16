import type { SolicitudResponse } from '@viaticos/contracts';

/** Aprobador del turno actual (null si la ruta terminó o fue rechazada). */
export function aprobadorActual(s: SolicitudResponse): string | null {
  if (s.estado !== 'EN_APROBACION' || s.ruta.some((p) => p.estado === 'RECHAZADO')) return null;
  return s.ruta.find((p) => p.estado === 'PENDIENTE')?.aprobadorId ?? null;
}

/** El turno normal o el nivel superior (directivo o gerencia), que puede aprobar sin esperar. */
export function puedeDecidir(s: SolicitudResponse, usuarioId: string | undefined): boolean {
  if (!usuarioId || aprobadorActual(s) === null) return false;
  if (aprobadorActual(s) === usuarioId) return true;
  return s.ruta.some((p) => p.estado === 'PENDIENTE' && p.aprobadorId === usuarioId && (p.nivel === 'JEFE_DIRECTIVO' || p.nivel === 'GERENCIA'));
}

export const puedeCancelar = (s: SolicitudResponse, usuarioId: string | undefined) =>
  s.estado === 'EN_APROBACION' && s.viajeroId === usuarioId;
