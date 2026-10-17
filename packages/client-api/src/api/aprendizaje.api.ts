import type { AxiosInstance } from 'axios';
import type { Aprendizaje, AprendizajeCambios, EstadoAprendizaje, HistorialAprendizaje, Lista, Pagina, TipoAprendizaje } from '@viaticos/contracts';

export interface FiltrosAprendizaje {
  kind?: TipoAprendizaje;
  status?: EstadoAprendizaje;
  /** Lo de la compañía choca con lo del grupo. */
  conflicted?: boolean;
  limit?: number;
  offset?: number;
}

/** Lo que el sistema aprendió de las correcciones: concepto por texto de línea y categoría por NIT. */
export interface AprendizajeApi {
  listar(filtros?: FiltrosAprendizaje): Promise<Pagina<Aprendizaje>>;
  historial(id: string): Promise<HistorialAprendizaje[]>;
  cambiar(id: string, cambios: AprendizajeCambios): Promise<Aprendizaje>;
  /** Valida (o no) la corrección de un empleado de su equipo. */
  validar(id: string, aprobado: boolean): Promise<Aprendizaje>;
}

export const crearAprendizajeApi = (http: AxiosInstance): AprendizajeApi => ({
  listar: async (filtros = {}) => (await http.get<Pagina<Aprendizaje>>('/classification-examples', { params: filtros })).data,
  historial: async (id) => (await http.get<Lista<HistorialAprendizaje>>(`/classification-examples/${id}/history`)).data.data,
  cambiar: async (id, cambios) => (await http.patch<Aprendizaje>(`/classification-examples/${id}`, cambios)).data,
  validar: async (id, aprobado) => (await http.post<Aprendizaje>(`/classification-examples/${id}/${aprobado ? 'approve' : 'reject'}`)).data,
});
