import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FiltrosAprendizaje } from '@viaticos/client-api';
import type { AprendizajeCambios } from '@viaticos/contracts';
import { useApi } from '../contexto';

export const clavesAprendizaje = {
  todos: ['aprendizaje'] as const,
  lista: (filtros: FiltrosAprendizaje) => [...clavesAprendizaje.todos, 'lista', filtros] as const,
  historial: (id: string) => [...clavesAprendizaje.todos, 'historial', id] as const,
};

export function useAprendizajes(filtros: FiltrosAprendizaje = {}, activa = true) {
  const api = useApi();
  return useQuery({ queryKey: clavesAprendizaje.lista(filtros), queryFn: () => api.aprendizaje.listar(filtros), enabled: activa });
}

export function useHistorialAprendizaje(id: string) {
  const api = useApi();
  return useQuery({ queryKey: clavesAprendizaje.historial(id), queryFn: () => api.aprendizaje.historial(id) });
}

export function useAccionAprendizaje() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accion: { id: string; cambios: AprendizajeCambios } | { id: string; aprobado: boolean }) =>
      'cambios' in accion ? api.aprendizaje.cambiar(accion.id, accion.cambios) : api.aprendizaje.validar(accion.id, accion.aprobado),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clavesAprendizaje.todos }),
  });
}
