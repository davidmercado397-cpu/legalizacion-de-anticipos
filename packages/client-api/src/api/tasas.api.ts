import type { AxiosInstance } from 'axios';
import { tasasDelDiaResponseSchema, type TasasDelDiaResponse } from '@viaticos/contracts';

export interface TasasApi {
  delDia(fecha?: string): Promise<TasasDelDiaResponse>;
}

export const crearTasasApi = (http: AxiosInstance): TasasApi => ({
  delDia: async (fecha) => tasasDelDiaResponseSchema.parse((await http.get('/tasas', { params: { fecha } })).data),
});
