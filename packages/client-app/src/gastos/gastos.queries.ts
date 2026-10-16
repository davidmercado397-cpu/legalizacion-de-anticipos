import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArchivoParaSubir } from '@viaticos/client-api';
import type { Confirmacion, CorreccionGasto, DecisionRevision } from '@viaticos/contracts';
import { clavesAnticipos } from '../anticipos/anticipos.queries';
import { useApi } from '../contexto';

export const clavesGastos = {
  todos: ['gastos'] as const,
  lineas: (id: string) => [...clavesGastos.todos, 'lineas', id] as const,
};

/** Un gasto cambia el saldo y el detalle del anticipo: se refresca todo lo de anticipos. */
function useAlCambiar() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: clavesAnticipos.todos });
    void queryClient.invalidateQueries({ queryKey: clavesGastos.todos });
  };
}

export function useSubirGasto() {
  const api = useApi();
  const alCambiar = useAlCambiar();
  return useMutation({
    mutationFn: ({ archivo, anticipoId, nombre }: { archivo: ArchivoParaSubir; anticipoId?: string; nombre?: string }) =>
      api.gastos.subir(archivo, { ...(anticipoId ? { anticipoId } : {}), ...(nombre ? { nombre } : {}), clientRef: crypto.randomUUID() }),
    onSuccess: alCambiar,
  });
}

export function useCorregirGasto() {
  const api = useApi();
  const alCambiar = useAlCambiar();
  return useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: CorreccionGasto }) => api.gastos.corregir(id, cambios),
    onSuccess: alCambiar,
  });
}

export function useConfirmarGasto() {
  const api = useApi();
  const alCambiar = useAlCambiar();
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: Confirmacion }) => api.gastos.confirmar(id, datos),
    onSuccess: alCambiar,
  });
}

export function useDescartarGasto() {
  const api = useApi();
  const alCambiar = useAlCambiar();
  return useMutation({ mutationFn: (id: string) => api.gastos.descartar(id), onSuccess: alCambiar });
}

export function useCorregirLinea() {
  const api = useApi();
  const alCambiar = useAlCambiar();
  return useMutation({
    mutationFn: ({ id, lineaId, concepto }: { id: string; lineaId: string; concepto: string | null }) =>
      api.gastos.corregirLinea(id, lineaId, concepto),
    onSuccess: alCambiar,
  });
}

export function useRevisarGasto() {
  const api = useApi();
  const alCambiar = useAlCambiar();
  return useMutation({
    mutationFn: ({ id, decision, nota }: { id: string; decision: DecisionRevision; nota: string | null }) =>
      api.gastos.revisar(id, decision, nota),
    onSuccess: alCambiar,
  });
}

export function useGastos(filtros: Parameters<ReturnType<typeof useApi>['gastos']['listar']>[0] = {}) {
  const api = useApi();
  return useQuery({ queryKey: [...clavesGastos.todos, 'lista', filtros], queryFn: () => api.gastos.listar(filtros) });
}
