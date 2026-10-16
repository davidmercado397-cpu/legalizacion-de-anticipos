import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FiltrosAnticipos } from '@viaticos/client-api';
import type { Anticipo, Desembolso, Devolucion, Liquidacion, SolicitudAnticipo, Viaje } from '@viaticos/contracts';
import { useApi } from '../contexto';

export const clavesAnticipos = {
  todos: ['anticipos'] as const,
  saldos: () => [...clavesAnticipos.todos, 'saldos'] as const,
  lista: (filtros: FiltrosAnticipos) => [...clavesAnticipos.todos, 'lista', filtros] as const,
  detalle: (id: string) => [...clavesAnticipos.todos, 'detalle', id] as const,
  lineaDeTiempo: (id: string) => [...clavesAnticipos.todos, 'linea', id] as const,
};

export function useSaldosAbiertos() {
  const api = useApi();
  return useQuery({ queryKey: clavesAnticipos.saldos(), queryFn: () => api.anticipos.saldosAbiertos() });
}

export function useAnticipos(filtros: FiltrosAnticipos = {}) {
  const api = useApi();
  return useQuery({ queryKey: clavesAnticipos.lista(filtros), queryFn: () => api.anticipos.listar(filtros) });
}

export function usePendientesDeAprobar() {
  const api = useApi();
  return useQuery({ queryKey: [...clavesAnticipos.todos, 'por-aprobar'], queryFn: () => api.anticipos.pendientesDeAprobar() });
}

/** Detalle con los gastos. Mientras alguno se esté leyendo con IA, se vuelve a consultar cada pocos segundos. */
export function useAnticipo(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: clavesAnticipos.detalle(id),
    queryFn: () => api.anticipos.obtener(id),
    refetchInterval: (consulta) =>
      consulta.state.data?.expenses.some((g) => g.status === 'received' || g.status === 'processing') ? 3000 : false,
  });
}

export function useLineaDeTiempo(id: string) {
  const api = useApi();
  return useQuery({ queryKey: clavesAnticipos.lineaDeTiempo(id), queryFn: () => api.anticipos.lineaDeTiempo(id) });
}

export function usePresupuesto() {
  const api = useApi();
  return useMutation({ mutationFn: (viaje: Viaje) => api.anticipos.presupuesto(viaje) });
}

/** Tras cualquier cambio de un anticipo se refrescan sus listados, saldos y detalle. */
function useAlCambiar() {
  const queryClient = useQueryClient();
  return (anticipo: Anticipo) => {
    void queryClient.invalidateQueries({ queryKey: clavesAnticipos.todos });
    return anticipo;
  };
}

export function useSolicitarAnticipo() {
  const api = useApi();
  const alCambiar = useAlCambiar();
  return useMutation({ mutationFn: (datos: SolicitudAnticipo) => api.anticipos.solicitar(datos), onSuccess: alCambiar });
}

type Accion =
  | { tipo: 'aprobar' | 'cancelar' | 'enviar' | 'cerrar' }
  | { tipo: 'rechazar'; nota: string | null }
  | { tipo: 'anular' | 'reabrir'; nota: string }
  | { tipo: 'devolver'; datos: Devolucion }
  | { tipo: 'desembolsar'; datos: Desembolso }
  | { tipo: 'liquidar'; datos: Liquidacion };

/** Una sola mutación para las transiciones del anticipo: la API valida quién puede qué. */
export function useAccionAnticipo(id: string) {
  const api = useApi();
  const alCambiar = useAlCambiar();
  return useMutation({
    mutationFn: (accion: Accion) => {
      const a = api.anticipos;
      switch (accion.tipo) {
        case 'aprobar':
          return a.aprobar(id);
        case 'cancelar':
          return a.cancelar(id);
        case 'enviar':
          return a.enviar(id);
        case 'cerrar':
          return a.cerrar(id);
        case 'rechazar':
          return a.rechazar(id, accion.nota);
        case 'anular':
          return a.anular(id, accion.nota);
        case 'reabrir':
          return a.reabrir(id, accion.nota);
        case 'devolver':
          return a.devolver(id, accion.datos);
        case 'desembolsar':
          return a.desembolsar(id, accion.datos);
        case 'liquidar':
          return a.liquidar(id, accion.datos);
      }
    },
    onSuccess: alCambiar,
  });
}

export function useSugerenciasDevolucion(id: string, activa: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...clavesAnticipos.detalle(id), 'sugerencias'],
    queryFn: () => api.anticipos.sugerenciasDevolucion(id),
    enabled: activa,
  });
}

export function useDescargarExcel() {
  const api = useApi();
  return useMutation({ mutationFn: (id: string) => api.anticipos.excel(id) });
}
