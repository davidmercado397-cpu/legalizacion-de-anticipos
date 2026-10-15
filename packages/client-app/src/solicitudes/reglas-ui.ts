import type { SolicitudResponse } from '@viaticos/contracts';

/** Aprobador del turno actual (null si la ruta terminó o fue rechazada). */
export function aprobadorActual(s: SolicitudResponse): string | null {
  if (s.estado !== 'EN_APROBACION' || s.ruta.some((p) => p.estado === 'RECHAZADO')) return null;
  return s.ruta.find((p) => p.estado === 'PENDIENTE')?.aprobadorId ?? null;
}

export const puedeDecidir = (s: SolicitudResponse, usuarioId: string | undefined) =>
  !!usuarioId && aprobadorActual(s) === usuarioId;

export const puedeCancelar = (s: SolicitudResponse, usuarioId: string | undefined) =>
  s.estado === 'EN_APROBACION' && s.viajeroId === usuarioId;
