import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Api } from '@viaticos/client-api';
import type { CrearSolicitudRequest, EstimarViajeRequest, SolicitudResponse } from '@viaticos/contracts';
import { useApi } from '../contexto';

export const clavesSolicitudes = {
  todas: ['solicitudes'] as const,
  mias: () => [...clavesSolicitudes.todas, 'mias'] as const,
  pendientes: () => [...clavesSolicitudes.todas, 'pendientes'] as const,
  detalle: (id: string) => [...clavesSolicitudes.todas, 'detalle', id] as const,
  destinos: () => ['destinos-disponibles'] as const,
  estimado: (datos: EstimarViajeRequest | null) => ['estimado', datos] as const,
};

// queryOptions reutilizables en loaders del router (ensureQueryData) y en componentes (useQuery).
export const misSolicitudesOptions = (api: Api) =>
  queryOptions({ queryKey: clavesSolicitudes.mias(), queryFn: () => api.solicitudes.misSolicitudes() });

export const pendientesOptions = (api: Api) =>
  queryOptions({ queryKey: clavesSolicitudes.pendientes(), queryFn: () => api.solicitudes.pendientesDeAprobar() });

export const solicitudOptions = (api: Api, id: string) =>
  queryOptions({ queryKey: clavesSolicitudes.detalle(id), queryFn: () => api.solicitudes.obtener(id) });

export const destinosOptions = (api: Api) =>
  queryOptions({
    queryKey: clavesSolicitudes.destinos(),
    queryFn: () => api.solicitudes.destinosDisponibles(),
    staleTime: 10 * 60_000,
  });

/** Estimado en vivo: `datos` null = formulario aún incompleto (no consulta). Mantiene el último resultado mientras recalcula. */
export function useEstimado(datos: EstimarViajeRequest | null) {
  const api = useApi();
  return useQuery({
    queryKey: clavesSolicitudes.estimado(datos),
    queryFn: ({ signal }) => api.solicitudes.estimar(datos!, signal),
    enabled: datos !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });
}

function useAlActualizarSolicitud() {
  const queryClient = useQueryClient();
  return (solicitud: SolicitudResponse) => {
    queryClient.setQueryData(clavesSolicitudes.detalle(solicitud.id), solicitud);
    // Una aprobación final crea un anticipo: también se refrescan los anticipos.
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: clavesSolicitudes.todas }),
      queryClient.invalidateQueries({ queryKey: ['anticipos'] }),
    ]);
  };
}

export function useCrearSolicitud() {
  const api = useApi();
  const alActualizar = useAlActualizarSolicitud();
  return useMutation({ mutationFn: (datos: CrearSolicitudRequest) => api.solicitudes.crear(datos), onSuccess: alActualizar });
}

export function useAprobarSolicitud() {
  const api = useApi();
  const alActualizar = useAlActualizarSolicitud();
  return useMutation({
    mutationFn: ({ id, comentario }: { id: string; comentario?: string }) => api.solicitudes.aprobar(id, comentario),
    onSuccess: alActualizar,
  });
}

export function useRechazarSolicitud() {
  const api = useApi();
  const alActualizar = useAlActualizarSolicitud();
  return useMutation({
    mutationFn: ({ id, comentario }: { id: string; comentario: string }) => api.solicitudes.rechazar(id, comentario),
    onSuccess: alActualizar,
  });
}

export function useCancelarSolicitud() {
  const api = useApi();
  const alActualizar = useAlActualizarSolicitud();
  return useMutation({ mutationFn: (id: string) => api.solicitudes.cancelar(id), onSuccess: alActualizar });
}
