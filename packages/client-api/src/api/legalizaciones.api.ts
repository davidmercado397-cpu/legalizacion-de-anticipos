import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import {
  legalizacionResponseSchema,
  politicaLegalizacionResponseSchema,
  type ConfirmarSoporteRequest,
  type DecisionSoporteRequest,
  type EstadoLegalizacion,
  type LegalizacionResponse,
  type PoliticaLegalizacionRequest,
  type PoliticaLegalizacionResponse,
  type ReciboCajaRequest,
} from '@viaticos/contracts';

export interface ArchivoParaSubir {
  /** Blob en web; en React Native, el objeto { uri, name, type } que acepta FormData. */
  contenido: Blob;
  nombre: string;
}

export interface LegalizacionesApi {
  porAnticipo(anticipoId: string): Promise<LegalizacionResponse>;
  obtener(id: string): Promise<LegalizacionResponse>;
  porEstados(estados?: EstadoLegalizacion[]): Promise<LegalizacionResponse[]>;
  subirFactura(id: string, datos: { descripcion: string; archivo: ArchivoParaSubir }, alProgresar?: (fraccion: number) => void): Promise<LegalizacionResponse>;
  agregarReciboCaja(id: string, datos: ReciboCajaRequest, archivo?: ArchivoParaSubir | null): Promise<LegalizacionResponse>;
  confirmarSoporte(id: string, soporteId: string, datos: ConfirmarSoporteRequest): Promise<LegalizacionResponse>;
  eliminarSoporte(id: string, soporteId: string): Promise<LegalizacionResponse>;
  /** Contenido del soporte (requiere el token, por eso no se usa la URL directa en <img>). */
  archivo(id: string, soporteId: string): Promise<Blob>;
  enviar(id: string): Promise<LegalizacionResponse>;
  decidirSoporte(id: string, soporteId: string, datos: DecisionSoporteRequest): Promise<LegalizacionResponse>;
  aprobar(id: string): Promise<LegalizacionResponse>;
  devolver(id: string, comentario: string): Promise<LegalizacionResponse>;
  politica(): Promise<PoliticaLegalizacionResponse>;
  actualizarPolitica(datos: PoliticaLegalizacionRequest): Promise<PoliticaLegalizacionResponse>;
}

const lista = z.array(legalizacionResponseSchema);
const r = (id: string) => `/legalizaciones/${encodeURIComponent(id)}`;
const s = (id: string, soporteId: string) => `${r(id)}/soportes/${encodeURIComponent(soporteId)}`;
const parse = (data: unknown) => legalizacionResponseSchema.parse(data);

export const crearLegalizacionesApi = (http: AxiosInstance): LegalizacionesApi => ({
  porAnticipo: async (anticipoId) => parse((await http.get(`/legalizaciones/por-anticipo/${encodeURIComponent(anticipoId)}`)).data),
  obtener: async (id) => parse((await http.get(r(id))).data),
  porEstados: async (estados) =>
    lista.parse((await http.get('/legalizaciones', { params: { estado: estados }, paramsSerializer: { indexes: null } })).data),
  subirFactura: async (id, datos, alProgresar) => {
    const form = new FormData();
    form.append('descripcion', datos.descripcion);
    form.append('archivo', datos.archivo.contenido, datos.archivo.nombre);
    const respuesta = await http.post(`${r(id)}/soportes`, form, {
      onUploadProgress: (e) => alProgresar?.(e.total ? e.loaded / e.total : 0),
    });
    return parse(respuesta.data);
  },
  agregarReciboCaja: async (id, datos, archivo) => {
    const form = new FormData();
    for (const [clave, valor] of Object.entries(datos)) if (valor !== undefined && valor !== null) form.append(clave, String(valor));
    if (archivo) form.append('archivo', archivo.contenido, archivo.nombre);
    return parse((await http.post(`${r(id)}/recibos-caja`, form)).data);
  },
  confirmarSoporte: async (id, soporteId, datos) => parse((await http.put(`${s(id, soporteId)}/confirmacion`, datos)).data),
  eliminarSoporte: async (id, soporteId) => parse((await http.delete(s(id, soporteId))).data),
  archivo: async (id, soporteId) => (await http.get(`${s(id, soporteId)}/archivo`, { responseType: 'blob' })).data as Blob,
  enviar: async (id) => parse((await http.post(`${r(id)}/enviar`, {})).data),
  decidirSoporte: async (id, soporteId, datos) => parse((await http.post(`${s(id, soporteId)}/decision`, datos)).data),
  aprobar: async (id) => parse((await http.post(`${r(id)}/aprobar`, {})).data),
  devolver: async (id, comentario) => parse((await http.post(`${r(id)}/devolver`, { comentario })).data),
  politica: async () => politicaLegalizacionResponseSchema.parse((await http.get('/politica-legalizacion')).data),
  actualizarPolitica: async (datos) => politicaLegalizacionResponseSchema.parse((await http.put('/politica-legalizacion', datos)).data),
});
