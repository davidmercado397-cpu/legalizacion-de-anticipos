import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Api, ArchivoParaSubir } from '@viaticos/client-api';
import type {
  ConfirmarSoporteRequest,
  DecisionSoporteRequest,
  EstadoLegalizacion,
  LegalizacionResponse,
  PoliticaLegalizacionRequest,
  ReciboCajaRequest,
} from '@viaticos/contracts';
import { clavesAnticipos } from '../anticipos/anticipos.queries';
import { useApi } from '../contexto';

export const clavesLegalizaciones = {
  todas: ['legalizaciones'] as const,
  detalle: (id: string) => [...clavesLegalizaciones.todas, 'detalle', id] as const,
  porAnticipo: (anticipoId: string) => [...clavesLegalizaciones.todas, 'anticipo', anticipoId] as const,
  porEstados: (estados: readonly EstadoLegalizacion[]) => [...clavesLegalizaciones.todas, 'estados', [...estados].sort()] as const,
  archivo: (id: string, soporteId: string) => ['archivo-soporte', id, soporteId] as const,
  politica: () => ['politica-legalizacion'] as const,
};

/** Mientras haya facturas en lectura automática, se consulta cada 2 s. */
const mientrasProcesa = (l: LegalizacionResponse | undefined) =>
  l?.soportes.some((s) => s.estado === 'PROCESANDO') ? 2000 : false;

export const legalizacionPorAnticipoOptions = (api: Api, anticipoId: string) =>
  queryOptions({
    queryKey: clavesLegalizaciones.porAnticipo(anticipoId),
    queryFn: () => api.legalizaciones.porAnticipo(anticipoId),
    refetchInterval: (q) => mientrasProcesa(q.state.data),
  });

export const legalizacionOptions = (api: Api, id: string) =>
  queryOptions({
    queryKey: clavesLegalizaciones.detalle(id),
    queryFn: () => api.legalizaciones.obtener(id),
    refetchInterval: (q) => mientrasProcesa(q.state.data),
  });

export const bandejaContabilidadOptions = (api: Api, estados: EstadoLegalizacion[] = ['EN_REVISION']) =>
  queryOptions({ queryKey: clavesLegalizaciones.porEstados(estados), queryFn: () => api.legalizaciones.porEstados(estados) });

export const archivoSoporteOptions = (api: Api, id: string, soporteId: string) =>
  queryOptions({
    queryKey: clavesLegalizaciones.archivo(id, soporteId),
    queryFn: () => api.legalizaciones.archivo(id, soporteId),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });

export const politicaLegalizacionOptions = (api: Api) =>
  queryOptions({ queryKey: clavesLegalizaciones.politica(), queryFn: () => api.legalizaciones.politica(), staleTime: 5 * 60_000 });

function useAlActualizar() {
  const qc = useQueryClient();
  return (l: LegalizacionResponse) => {
    qc.setQueryData(clavesLegalizaciones.detalle(l.id), l);
    qc.setQueryData(clavesLegalizaciones.porAnticipo(l.anticipoId), l);
    return Promise.all([
      qc.invalidateQueries({ queryKey: clavesLegalizaciones.todas, predicate: (q) => q.queryKey[1] === 'estados' }),
      qc.invalidateQueries({ queryKey: clavesAnticipos.todos }),
    ]);
  };
}

function useMutacionLegalizacion<V>(fn: (api: Api, variables: V) => Promise<LegalizacionResponse>) {
  const api = useApi();
  const alActualizar = useAlActualizar();
  return useMutation({ mutationFn: (v: V) => fn(api, v), onSuccess: alActualizar });
}

export const useSubirFactura = () =>
  useMutacionLegalizacion((api, v: { id: string; descripcion: string; archivo: ArchivoParaSubir; alProgresar?: (f: number) => void }) =>
    api.legalizaciones.subirFactura(v.id, { descripcion: v.descripcion, archivo: v.archivo }, v.alProgresar),
  );
export const useAgregarReciboCaja = () =>
  useMutacionLegalizacion((api, v: { id: string; datos: ReciboCajaRequest; archivo?: ArchivoParaSubir | null }) =>
    api.legalizaciones.agregarReciboCaja(v.id, v.datos, v.archivo),
  );
export const useConfirmarSoporte = () =>
  useMutacionLegalizacion((api, v: { id: string; soporteId: string; datos: ConfirmarSoporteRequest }) =>
    api.legalizaciones.confirmarSoporte(v.id, v.soporteId, v.datos),
  );
export const useEliminarSoporte = () =>
  useMutacionLegalizacion((api, v: { id: string; soporteId: string }) => api.legalizaciones.eliminarSoporte(v.id, v.soporteId));
export const useEnviarLegalizacion = () => useMutacionLegalizacion((api, id: string) => api.legalizaciones.enviar(id));
export const useDecidirSoporte = () =>
  useMutacionLegalizacion((api, v: { id: string; soporteId: string; datos: DecisionSoporteRequest }) =>
    api.legalizaciones.decidirSoporte(v.id, v.soporteId, v.datos),
  );
export const useDecidirLinea = () =>
  useMutacionLegalizacion((api, v: { id: string; soporteId: string; indice: number; excluir: boolean }) =>
    api.legalizaciones.decidirLinea(v.id, v.soporteId, v.indice, v.excluir),
  );
export const useAprobarLegalizacion = () => useMutacionLegalizacion((api, id: string) => api.legalizaciones.aprobar(id));
export const useDevolverLegalizacion = () =>
  useMutacionLegalizacion((api, v: { id: string; comentario: string }) => api.legalizaciones.devolver(v.id, v.comentario));

export function useActualizarPolitica() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (datos: PoliticaLegalizacionRequest) => api.legalizaciones.actualizarPolitica(datos),
    onSuccess: (p) => qc.setQueryData(clavesLegalizaciones.politica(), p),
  });
}
