import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Api, ArchivoParaSubir, DatosCargaExtracto } from '@viaticos/client-api';
import type { ExtractoResponse, PerfilExtractoDto } from '@viaticos/contracts';
import { useApi } from '../contexto';

export const clavesConciliacion = {
  todas: ['conciliacion'] as const,
  detalle: (id: string) => [...clavesConciliacion.todas, 'detalle', id] as const,
  lista: (legalizacionId?: string) => [...clavesConciliacion.todas, 'lista', legalizacionId ?? 'todas'] as const,
};

export const extractosOptions = (api: Api, legalizacionId?: string) =>
  queryOptions({ queryKey: clavesConciliacion.lista(legalizacionId), queryFn: () => api.conciliacion.listar(legalizacionId) });

export const extractoOptions = (api: Api, id: string) =>
  queryOptions({ queryKey: clavesConciliacion.detalle(id), queryFn: () => api.conciliacion.obtener(id) });

/** Lee el archivo sin guardarlo (mapeo sugerido o el indicado). */
export const useVistaPreviaExtracto = () => {
  const api = useApi();
  return useMutation({
    mutationFn: (v: { archivo: ArchivoParaSubir; perfil?: PerfilExtractoDto; moneda?: string }) =>
      api.conciliacion.vistaPrevia(v.archivo, { ...(v.perfil && { perfil: v.perfil }), ...(v.moneda && { moneda: v.moneda }) }),
  });
};

function useAlActualizar() {
  const qc = useQueryClient();
  return (e: ExtractoResponse) => {
    qc.setQueryData(clavesConciliacion.detalle(e.id), e);
    return qc.invalidateQueries({ queryKey: [...clavesConciliacion.todas, 'lista'] });
  };
}

export const useCargarExtracto = () => {
  const api = useApi();
  const alActualizar = useAlActualizar();
  return useMutation({
    mutationFn: (v: { datos: DatosCargaExtracto; archivo: ArchivoParaSubir }) => api.conciliacion.cargar(v.datos, v.archivo),
    onSuccess: alActualizar,
  });
};

type AccionCruce = { id: string; movimientoId: string } & ({ accion: 'confirmar' | 'rechazar' } | { accion: 'enlazar'; soporteId: string });

export const useAccionCruce = () => {
  const api = useApi();
  const alActualizar = useAlActualizar();
  return useMutation({
    mutationFn: (v: AccionCruce) =>
      v.accion === 'enlazar' ? api.conciliacion.enlazar(v.id, v.movimientoId, v.soporteId) : api.conciliacion[v.accion](v.id, v.movimientoId),
    onSuccess: alActualizar,
  });
};

export const useRecalcularExtracto = () => {
  const api = useApi();
  const alActualizar = useAlActualizar();
  return useMutation({ mutationFn: (id: string) => api.conciliacion.recalcular(id), onSuccess: alActualizar });
};
