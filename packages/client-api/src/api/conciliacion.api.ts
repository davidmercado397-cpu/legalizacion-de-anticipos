import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import {
  extractoResponseSchema,
  extractoResumenResponseSchema,
  perfilGuardadoSchema,
  vistaPreviaExtractoResponseSchema,
  type ExtractoResponse,
  type ExtractoResumenResponse,
  type PerfilExtractoDto,
  type PerfilGuardadoResponse,
  type VistaPreviaExtractoResponse,
} from '@viaticos/contracts';
import type { ArchivoParaSubir } from './legalizaciones.api';

export interface DatosCargaExtracto {
  legalizacionId: string;
  ultimos4?: string;
  perfil: PerfilExtractoDto;
  guardarPerfilComo?: string;
}

export interface ConciliacionApi {
  vistaPrevia(archivo: ArchivoParaSubir, opciones?: { perfil?: PerfilExtractoDto; moneda?: string }): Promise<VistaPreviaExtractoResponse>;
  cargar(datos: DatosCargaExtracto, archivo: ArchivoParaSubir): Promise<ExtractoResponse>;
  /** Con legalizacionId: los del viajero; sin él: los recientes (contabilidad). */
  listar(legalizacionId?: string): Promise<ExtractoResumenResponse[]>;
  obtener(id: string): Promise<ExtractoResponse>;
  recalcular(id: string): Promise<ExtractoResponse>;
  confirmar(id: string, movimientoId: string): Promise<ExtractoResponse>;
  rechazar(id: string, movimientoId: string): Promise<ExtractoResponse>;
  enlazar(id: string, movimientoId: string, soporteId: string): Promise<ExtractoResponse>;
  perfiles(): Promise<PerfilGuardadoResponse[]>;
}

const e = (id: string) => `/conciliacion/extractos/${encodeURIComponent(id)}`;
const m = (id: string, movimientoId: string) => `${e(id)}/movimientos/${encodeURIComponent(movimientoId)}`;
const parse = (data: unknown) => extractoResponseSchema.parse(data);

export const crearConciliacionApi = (http: AxiosInstance): ConciliacionApi => ({
  vistaPrevia: async (archivo, opciones = {}) => {
    const form = new FormData();
    form.append('archivo', archivo.contenido, archivo.nombre);
    if (opciones.perfil) form.append('perfil', JSON.stringify(opciones.perfil));
    if (opciones.moneda) form.append('moneda', opciones.moneda);
    return vistaPreviaExtractoResponseSchema.parse((await http.post('/conciliacion/extractos/vista-previa', form)).data);
  },
  cargar: async (datos, archivo) => {
    const form = new FormData();
    form.append('legalizacionId', datos.legalizacionId);
    if (datos.ultimos4) form.append('ultimos4', datos.ultimos4);
    form.append('perfil', JSON.stringify(datos.perfil));
    if (datos.guardarPerfilComo) form.append('guardarPerfilComo', datos.guardarPerfilComo);
    form.append('archivo', archivo.contenido, archivo.nombre);
    return parse((await http.post('/conciliacion/extractos', form)).data);
  },
  listar: async (legalizacionId) =>
    z.array(extractoResumenResponseSchema).parse((await http.get('/conciliacion/extractos', { params: { legalizacionId } })).data),
  obtener: async (id) => parse((await http.get(e(id))).data),
  recalcular: async (id) => parse((await http.post(`${e(id)}/recalcular`, {})).data),
  confirmar: async (id, movimientoId) => parse((await http.post(`${m(id, movimientoId)}/confirmar`, {})).data),
  rechazar: async (id, movimientoId) => parse((await http.post(`${m(id, movimientoId)}/rechazar`, {})).data),
  enlazar: async (id, movimientoId, soporteId) => parse((await http.post(`${m(id, movimientoId)}/enlazar`, { soporteId })).data),
  perfiles: async () => z.array(perfilGuardadoSchema).parse((await http.get('/conciliacion/perfiles')).data),
});
