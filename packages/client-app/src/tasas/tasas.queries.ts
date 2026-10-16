import { queryOptions } from '@tanstack/react-query';
import type { Api } from '@viaticos/client-api';

const UNA_HORA = 60 * 60 * 1000;

/** Tasas por dólar vigentes hoy (TRM del día). Se refrescan cada hora, igual que en el servidor. */
export const tasasDelDiaOptions = (api: Api) =>
  queryOptions({
    queryKey: ['tasas', 'hoy'] as const,
    queryFn: () => api.tasas.delDia(),
    staleTime: UNA_HORA,
    refetchInterval: UNA_HORA,
  });
