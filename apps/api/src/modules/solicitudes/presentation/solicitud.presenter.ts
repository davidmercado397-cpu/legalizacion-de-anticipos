import type { EstimadoResponse, SolicitudResponse } from '@viaticos/contracts';
import type { ResultadoEscalamiento } from '../domain/escalamiento/regla-escalamiento';
import type { PresupuestoViaje } from '../domain/presupuesto-viaje';
import type { SolicitudViaje } from '../domain/solicitud-viaje';

export function presentarPresupuesto(p: PresupuestoViaje): EstimadoResponse['presupuesto'] {
  return {
    monedaAnticipo: p.monedaAnticipo,
    lineas: p.lineas.map((l) => ({
      destinoIndice: l.destinoIndice,
      paisCodigo: l.paisCodigo,
      conceptoCodigo: l.conceptoCodigo,
      conceptoNombre: l.conceptoNombre,
      unidad: l.unidad,
      cantidad: l.cantidad,
      tarifaUnitaria: l.tarifaUnitaria.toDto(),
      valorUnitarioSolicitado: l.valorUnitarioSolicitado.toDto(),
      subtotal: l.subtotal.toDto(),
      excedeTarifa: l.excedeTarifa,
    })),
    totalAnticipo: p.totalAnticipo.toDto(),
    tasasAplicadas: p.tasasAplicadas.map((t) => t.toDto()),
  };
}

export function presentarEstimado(e: {
  presupuesto: PresupuestoViaje;
  escalamiento: ResultadoEscalamiento;
}): EstimadoResponse {
  return { presupuesto: presentarPresupuesto(e.presupuesto), escalamiento: e.escalamiento };
}

export function presentarSolicitud(s: SolicitudViaje): SolicitudResponse {
  return {
    id: s.id,
    estado: s.estado,
    viajeroId: s.viajeroId,
    motivo: s.motivo,
    justificacion: s.justificacion,
    destinos: s.destinos.map((d) => d.toDatos()),
    presupuesto: presentarPresupuesto(s.presupuesto),
    escalamiento: s.escalamiento,
    ruta: s.ruta.pasosSnapshot.map((p) => ({ ...p, decididoEn: p.decididoEn?.toISOString() ?? null })),
    creadaEn: s.creadaEn.toISOString(),
    actualizadaEn: s.actualizadaEn.toISOString(),
  };
}
