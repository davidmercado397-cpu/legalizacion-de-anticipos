import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FiltrosAuditoria } from '@viaticos/client-api';
import { useApi } from '../contexto';

const raiz = ['plataforma'] as const;

export function useCostosIa(desde?: string, hasta?: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...raiz, 'costos', desde, hasta],
    queryFn: () => api.plataforma.costosIa(desde, hasta),
    placeholderData: keepPreviousData,
  });
}

export function useConfiguracion() {
  const api = useApi();
  return useQuery({ queryKey: [...raiz, 'configuracion'], queryFn: () => api.plataforma.configuracion() });
}

export function useCambiarConfiguracion() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (valores: Record<string, unknown>) => api.plataforma.cambiarConfiguracion(valores),
    onSuccess: (filas) => queryClient.setQueryData([...raiz, 'configuracion'], filas),
  });
}

export function useAuditoria(filtros: FiltrosAuditoria) {
  const api = useApi();
  return useQuery({
    queryKey: [...raiz, 'auditoria', filtros],
    queryFn: () => api.plataforma.auditoria(filtros),
    placeholderData: keepPreviousData,
  });
}
