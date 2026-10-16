import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TarifaNueva, ZonaViajeCambios, ZonaViajeNueva } from '@viaticos/contracts';
import { useApi } from '../contexto';
import { clavesOrganizacion } from './organizacion.queries';

export const clavesTarifas = {
  zonas: (companiaId: string) => [...clavesOrganizacion.todos, 'zonas', companiaId] as const,
  tarifas: (companiaId: string) => [...clavesOrganizacion.todos, 'tarifas', companiaId] as const,
};

export function useZonas(companiaId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: clavesTarifas.zonas(companiaId ?? ''),
    queryFn: () => api.organizacion.zonas(companiaId!),
    enabled: !!companiaId,
  });
}

export function useTarifas(companiaId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: clavesTarifas.tarifas(companiaId ?? ''),
    queryFn: () => api.organizacion.tarifas(companiaId!),
    enabled: !!companiaId,
  });
}

/** Cualquier cambio en zonas o tarifas refresca ambas listas (una tarifa muestra el nombre de su zona). */
function useAlCambiar(companiaId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: clavesTarifas.zonas(companiaId) });
    void queryClient.invalidateQueries({ queryKey: clavesTarifas.tarifas(companiaId) });
  };
}

export function useGuardarZona(companiaId: string) {
  const api = useApi();
  const alCambiar = useAlCambiar(companiaId);
  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: ZonaViajeNueva | ZonaViajeCambios }) =>
      id ? api.organizacion.actualizarZona(companiaId, id, datos) : api.organizacion.crearZona(companiaId, datos as ZonaViajeNueva),
    onSuccess: alCambiar,
  });
}

export function useCrearTarifa(companiaId: string) {
  const api = useApi();
  const alCambiar = useAlCambiar(companiaId);
  return useMutation({ mutationFn: (datos: TarifaNueva) => api.organizacion.crearTarifa(companiaId, datos), onSuccess: alCambiar });
}

export function useDesactivarTarifa(companiaId: string) {
  const api = useApi();
  const alCambiar = useAlCambiar(companiaId);
  return useMutation({ mutationFn: (tarifaId: string) => api.organizacion.desactivarTarifa(companiaId, tarifaId), onSuccess: alCambiar });
}

export function useImportarTarifas(companiaId: string) {
  const api = useApi();
  const alCambiar = useAlCambiar(companiaId);
  return useMutation({
    mutationFn: (archivo: File) => api.organizacion.importarTarifas(companiaId, archivo, archivo.name),
    onSuccess: alCambiar,
  });
}
