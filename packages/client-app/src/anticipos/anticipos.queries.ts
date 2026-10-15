import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Api } from '@viaticos/client-api';
import type { AnticipoResponse, EstadoAnticipo, RegistrarDesembolsoRequest } from '@viaticos/contracts';
import { useApi } from '../contexto';

export const clavesAnticipos = {
  todos: ['anticipos'] as const,
  mios: () => [...clavesAnticipos.todos, 'mios'] as const,
  porEstados: (estados: readonly EstadoAnticipo[]) => [...clavesAnticipos.todos, 'estados', [...estados].sort()] as const,
  detalle: (id: string) => [...clavesAnticipos.todos, 'detalle', id] as const,
};

export const BANDEJA_TESORERIA: EstadoAnticipo[] = ['PENDIENTE_ERP', 'POR_DESEMBOLSAR'];

export const misAnticiposOptions = (api: Api) =>
  queryOptions({ queryKey: clavesAnticipos.mios(), queryFn: () => api.anticipos.mios() });

export const anticiposPorEstadoOptions = (api: Api, estados: EstadoAnticipo[] = BANDEJA_TESORERIA) =>
  queryOptions({ queryKey: clavesAnticipos.porEstados(estados), queryFn: () => api.anticipos.porEstados(estados) });

export const anticipoOptions = (api: Api, id: string) =>
  queryOptions({ queryKey: clavesAnticipos.detalle(id), queryFn: () => api.anticipos.obtener(id) });

function useAlActualizarAnticipo() {
  const queryClient = useQueryClient();
  return (anticipo: AnticipoResponse) => {
    queryClient.setQueryData(clavesAnticipos.detalle(anticipo.id), anticipo);
    return queryClient.invalidateQueries({ queryKey: clavesAnticipos.todos });
  };
}

export function useRegistrarDesembolso() {
  const api = useApi();
  const alActualizar = useAlActualizarAnticipo();
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: RegistrarDesembolsoRequest }) => api.anticipos.registrarDesembolso(id, datos),
    onSuccess: alActualizar,
  });
}

export function useReintentarErp() {
  const api = useApi();
  const alActualizar = useAlActualizarAnticipo();
  return useMutation({ mutationFn: (id: string) => api.anticipos.reintentarErp(id), onSuccess: alActualizar });
}
