import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FiltrosEmpleados } from '@viaticos/client-api';
import type { CompaniaCambios, CompaniaNueva, EmpleadoCambios, EmpleadoNuevo, ReglaPoliticaNueva } from '@viaticos/contracts';
import { useApi } from '../contexto';

export const clavesOrganizacion = {
  todos: ['organizacion'] as const,
  companias: () => [...clavesOrganizacion.todos, 'companias'] as const,
  categorias: (id: string) => [...clavesOrganizacion.todos, 'categorias', id] as const,
  reglas: (id: string) => [...clavesOrganizacion.todos, 'reglas', id] as const,
  conceptos: (id: string) => [...clavesOrganizacion.todos, 'conceptos', id] as const,
  empleados: (filtros: FiltrosEmpleados) => [...clavesOrganizacion.todos, 'empleados', filtros] as const,
};

export function useCompanias() {
  const api = useApi();
  return useQuery({ queryKey: clavesOrganizacion.companias(), queryFn: () => api.organizacion.companias(), staleTime: 5 * 60_000 });
}

export function useCategorias(companiaId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: clavesOrganizacion.categorias(companiaId ?? ''),
    queryFn: () => api.organizacion.categorias(companiaId!),
    enabled: !!companiaId,
    staleTime: 5 * 60_000,
  });
}

export function useConceptosBloqueados(companiaId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: clavesOrganizacion.conceptos(companiaId ?? ''),
    queryFn: () => api.organizacion.conceptosBloqueados(companiaId!),
    enabled: !!companiaId,
    staleTime: 5 * 60_000,
  });
}

export function useReglas(companiaId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: clavesOrganizacion.reglas(companiaId ?? ''),
    queryFn: () => api.organizacion.reglas(companiaId!),
    enabled: !!companiaId,
  });
}

export function useConfigurarReglas(companiaId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reglas: ReglaPoliticaNueva[]) => api.organizacion.configurarReglas(companiaId, reglas),
    onSuccess: (reglas) => queryClient.setQueryData(clavesOrganizacion.reglas(companiaId), reglas),
  });
}

export function useEmpleados(filtros: FiltrosEmpleados = {}, activa = true) {
  const api = useApi();
  return useQuery({
    queryKey: clavesOrganizacion.empleados(filtros),
    queryFn: () => api.organizacion.empleados(filtros),
    enabled: activa,
  });
}

function useInvalidar() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: clavesOrganizacion.todos });
}

export function useGuardarCompania() {
  const api = useApi();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: CompaniaNueva | CompaniaCambios }) =>
      id ? api.organizacion.actualizarCompania(id, datos) : api.organizacion.crearCompania(datos as CompaniaNueva),
    onSuccess: invalidar,
  });
}

export function useGuardarEmpleado() {
  const api = useApi();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async ({ id, datos }: { id?: string; datos: EmpleadoNuevo | EmpleadoCambios }) =>
      id
        ? { empleado: await api.organizacion.actualizarEmpleado(id, datos), claveTemporal: null }
        : await api.organizacion.crearEmpleado(datos as EmpleadoNuevo).then(({ temporary_password, ...empleado }) => ({
            empleado,
            claveTemporal: temporary_password,
          })),
    onSuccess: invalidar,
  });
}

export function useAccionEmpleado() {
  const api = useApi();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (
      accion: { tipo: 'activar' | 'desactivar' | 'reiniciar_mfa'; id: string } | { tipo: 'clave_temporal'; id: string },
    ): Promise<string | null> => {
      if (accion.tipo === 'clave_temporal') return api.organizacion.claveTemporal(accion.id);
      if (accion.tipo === 'reiniciar_mfa') await api.organizacion.reiniciarMfa(accion.id);
      else await api.organizacion.activarEmpleado(accion.id, accion.tipo === 'activar');
      return null;
    },
    onSuccess: invalidar,
  });
}
