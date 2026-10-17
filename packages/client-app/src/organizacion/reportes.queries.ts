import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { Periodo, Reporte } from '@viaticos/client-api';
import { useApi } from '../contexto';

const raiz = ['reportes'] as const;

// Al cambiar el periodo se conserva lo anterior mientras llega lo nuevo: el tablero no salta.
const conservar = { placeholderData: keepPreviousData };

export function useSaldosPendientes(companiaId: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: [...raiz, 'saldos', companiaId], queryFn: () => api.reportes.saldosPendientes(companiaId), ...conservar });
}

export function useGastoPorConcepto(periodo: Periodo) {
  const api = useApi();
  return useQuery({ queryKey: [...raiz, 'gasto', periodo], queryFn: () => api.reportes.gasto(periodo), ...conservar });
}

export function useCumplimientoPresupuesto(periodo: Periodo) {
  const api = useApi();
  return useQuery({ queryKey: [...raiz, 'cumplimiento', periodo], queryFn: () => api.reportes.cumplimiento(periodo), ...conservar });
}

export function useFacturasOtraCompania(periodo: Periodo) {
  const api = useApi();
  return useQuery({ queryKey: [...raiz, 'otra-compania', periodo], queryFn: () => api.reportes.otraCompania(periodo), ...conservar });
}

export function usePrecisionIa(companiaId: string | undefined, mes: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...raiz, 'precision', companiaId, mes],
    queryFn: () => api.reportes.precisionIa(companiaId!, mes),
    enabled: !!companiaId,
    ...conservar,
  });
}

export function useUsoMes(mes: string) {
  const api = useApi();
  return useQuery({ queryKey: [...raiz, 'uso', mes], queryFn: () => api.reportes.uso(mes), ...conservar });
}

export function useDescargarReporte() {
  const api = useApi();
  return useMutation({
    mutationFn: ({ reporte, parametros }: { reporte: Reporte; parametros: Partial<Periodo> }) => api.reportes.excel(reporte, parametros),
  });
}
