import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import {
  anticipoResponseSchema,
  type AnticipoResponse,
  type EstadoAnticipo,
  type RegistrarDesembolsoRequest,
} from '@viaticos/contracts';

export interface AnticiposApi {
  mios(): Promise<AnticipoResponse[]>;
  porEstados(estados?: EstadoAnticipo[]): Promise<AnticipoResponse[]>;
  obtener(id: string): Promise<AnticipoResponse>;
  registrarDesembolso(id: string, datos: RegistrarDesembolsoRequest): Promise<AnticipoResponse>;
  reintentarErp(id: string): Promise<AnticipoResponse>;
}

const lista = z.array(anticipoResponseSchema);
const ruta = (id: string) => `/anticipos/${encodeURIComponent(id)}`;

export const crearAnticiposApi = (http: AxiosInstance): AnticiposApi => ({
  mios: async () => lista.parse((await http.get('/anticipos/mios')).data),
  porEstados: async (estados) =>
    lista.parse((await http.get('/anticipos', { params: { estado: estados }, paramsSerializer: { indexes: null } })).data),
  obtener: async (id) => anticipoResponseSchema.parse((await http.get(ruta(id))).data),
  registrarDesembolso: async (id, datos) => anticipoResponseSchema.parse((await http.post(`${ruta(id)}/desembolso`, datos)).data),
  reintentarErp: async (id) => anticipoResponseSchema.parse((await http.post(`${ruta(id)}/reintentar-erp`, {})).data),
});
