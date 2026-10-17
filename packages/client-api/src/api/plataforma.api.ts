import type { AxiosInstance } from 'axios';
import type { Configuracion, CostosIa, Lista, Pagina, RegistroAuditoria } from '@viaticos/contracts';

export interface FiltrosAuditoria {
  entity_type?: string;
  entity_id?: string;
  actor_id?: string;
  action?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface PlataformaApi {
  /** Meses en formato YYYY-MM; sin ellos, los últimos seis. */
  costosIa(desde?: string, hasta?: string): Promise<CostosIa>;
  configuracion(): Promise<Configuracion[]>;
  /** Se valida contra el tipo y el rango de cada llave y aplica sin reiniciar. */
  cambiarConfiguracion(valores: Record<string, unknown>): Promise<Configuracion[]>;
  auditoria(filtros?: FiltrosAuditoria): Promise<Pagina<RegistroAuditoria>>;
}

export const crearPlataformaApi = (http: AxiosInstance): PlataformaApi => ({
  costosIa: async (desde, hasta) => (await http.get<CostosIa>('/ai-costs', { params: { from: desde, to: hasta } })).data,
  configuracion: async () => (await http.get<Lista<Configuracion>>('/settings')).data.data,
  cambiarConfiguracion: async (valores) => (await http.patch<Lista<Configuracion>>('/settings', { values: valores })).data.data,
  auditoria: async (filtros = {}) => (await http.get<Pagina<RegistroAuditoria>>('/audit', { params: filtros })).data,
});
