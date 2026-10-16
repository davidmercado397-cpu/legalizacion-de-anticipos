import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SuplenciaNueva } from '@viaticos/contracts';
import { useApi } from '../contexto';
import { clavesOrganizacion } from './organizacion.queries';

const clave = (empleadoId: string) => [...clavesOrganizacion.todos, 'suplencias', empleadoId] as const;

export function useSuplencias(empleadoId: string) {
  const api = useApi();
  return useQuery({ queryKey: clave(empleadoId), queryFn: () => api.organizacion.suplencias(empleadoId) });
}

export function useAccionSuplencia(empleadoId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accion: { tipo: 'crear'; datos: SuplenciaNueva } | { tipo: 'revocar'; id: string }) => {
      if (accion.tipo === 'crear') await api.organizacion.crearSuplencia(empleadoId, accion.datos);
      else await api.organizacion.revocarSuplencia(empleadoId, accion.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clave(empleadoId) }),
  });
}

export type AccionWhatsApp = 'bienvenida' | 'codigo' | 'desvincular' | 'borrar_contacto';

/** Devuelve el código de vinculación cuando se pide uno; las demás acciones refrescan los usuarios. */
export function useAccionWhatsApp(empleadoId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accion: AccionWhatsApp) => {
      const o = api.organizacion;
      if (accion === 'codigo') return o.codigoWhatsApp(empleadoId);
      if (accion === 'bienvenida') await o.bienvenidaWhatsApp(empleadoId);
      else if (accion === 'desvincular') await o.desvincularWhatsApp(empleadoId);
      else await o.borrarContacto(empleadoId);
      return null;
    },
    onSuccess: (codigo) => {
      if (!codigo) void queryClient.invalidateQueries({ queryKey: clavesOrganizacion.todos });
    },
  });
}
