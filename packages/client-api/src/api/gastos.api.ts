import type { AxiosInstance } from 'axios';
import type {
  Confirmacion,
  CorreccionGasto,
  DecisionRevision,
  EstadoGasto,
  Gasto,
  LineaGasto,
  Lista,
  Pagina,
} from '@viaticos/contracts';

/** Archivo a subir: en web un File; en móvil, el objeto {uri, name, type} de React Native. */
export type ArchivoParaSubir = Blob | { uri: string; name: string; type: string };

export interface FiltrosGastos {
  status?: EstadoGasto;
  advance_id?: string;
  /** Para consultar solo lo que cambió (la lectura con IA sigue en segundo plano). */
  updated_since?: string;
  limit?: number;
  offset?: number;
}

export interface GastosApi {
  /** Responde de inmediato; la lectura con IA sigue en segundo plano. `clientRef` evita duplicados al reintentar. */
  subir(archivo: ArchivoParaSubir, datos: { anticipoId?: string; clientRef?: string; nombre?: string }): Promise<Gasto>;
  listar(filtros?: FiltrosGastos): Promise<Pagina<Gasto>>;
  obtener(id: string): Promise<Gasto>;
  corregir(id: string, cambios: CorreccionGasto): Promise<Gasto>;
  confirmar(id: string, datos: Confirmacion): Promise<Gasto>;
  descartar(id: string): Promise<Gasto>;
  lineas(id: string): Promise<LineaGasto[]>;
  /** null = la línea es permitida. */
  corregirLinea(id: string, lineaId: string, concepto: string | null): Promise<LineaGasto>;
  revisar(id: string, decision: DecisionRevision, nota: string | null): Promise<Gasto>;
}

export const crearGastosApi = (http: AxiosInstance): GastosApi => ({
  subir: async (archivo, { anticipoId, clientRef, nombre }) => {
    const formulario = new FormData();
    formulario.append('file', archivo as Blob, nombre);
    if (anticipoId) formulario.append('advance_id', anticipoId);
    if (clientRef) formulario.append('client_ref', clientRef);
    formulario.append('sent_at', new Date().toISOString());
    return (await http.post<Gasto>('/expenses', formulario, { timeout: 120_000 })).data;
  },
  listar: async (filtros = {}) => (await http.get<Pagina<Gasto>>('/expenses', { params: filtros })).data,
  obtener: async (id) => (await http.get<Gasto>(`/expenses/${id}`)).data,
  corregir: async (id, cambios) => (await http.patch<Gasto>(`/expenses/${id}`, cambios)).data,
  confirmar: async (id, datos) => (await http.post<Gasto>(`/expenses/${id}/confirm`, datos)).data,
  descartar: async (id) => (await http.post<Gasto>(`/expenses/${id}/discard`)).data,
  lineas: async (id) => (await http.get<Lista<LineaGasto>>(`/expenses/${id}/lines`)).data.data,
  corregirLinea: async (id, lineaId, concepto) =>
    (await http.patch<LineaGasto>(`/expenses/${id}/lines/${lineaId}`, { concept_code: concepto })).data,
  revisar: async (id, decision, nota) => (await http.post<Gasto>(`/expenses/${id}/review`, { decision, note: nota })).data,
});
