import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccionMovimiento, ArchivoExtracto } from '@viaticos/client-api';
import type { Extracto } from '@viaticos/contracts';
import { useApi } from '../contexto';
import { clavesAnticipos } from './anticipos.queries';

export const clavesConciliacion = {
  extractos: (anticipoId: string) => [...clavesAnticipos.detalle(anticipoId), 'extractos'] as const,
};

export function useExtractos(anticipoId: string, activa = true) {
  const api = useApi();
  return useQuery({
    queryKey: clavesConciliacion.extractos(anticipoId),
    queryFn: () => api.conciliacion.extractos(anticipoId),
    enabled: activa,
  });
}

export function useVistaPreviaExtracto(anticipoId: string) {
  const api = useApi();
  return useMutation({ mutationFn: (archivo: ArchivoExtracto) => api.conciliacion.vistaPrevia(anticipoId, archivo) });
}

/** Cargar o decidir un cruce cambia los gastos (valor del banco) y lo que falta para cerrar: se refresca el anticipo. */
function useAlConciliar(anticipoId: string) {
  const queryClient = useQueryClient();
  return (extracto: Extracto) => {
    void queryClient.invalidateQueries({ queryKey: clavesAnticipos.detalle(anticipoId) });
    return extracto;
  };
}

export function useCargarExtracto(anticipoId: string) {
  const api = useApi();
  const alConciliar = useAlConciliar(anticipoId);
  return useMutation({
    mutationFn: ({ archivo, ultimos4 }: { archivo: ArchivoExtracto; ultimos4?: string | null }) =>
      api.conciliacion.cargar(anticipoId, archivo, ultimos4),
    onSuccess: alConciliar,
  });
}

export function useAccionMovimiento(anticipoId: string) {
  const api = useApi();
  const alConciliar = useAlConciliar(anticipoId);
  return useMutation({
    mutationFn: ({ extractoId, movimientoId, accion }: { extractoId: string; movimientoId: string; accion: AccionMovimiento }) =>
      api.conciliacion.movimiento(extractoId, movimientoId, accion),
    onSuccess: alConciliar,
  });
}
