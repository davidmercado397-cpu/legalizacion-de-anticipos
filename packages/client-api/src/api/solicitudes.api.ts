import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import {
  estimadoResponseSchema,
  paisesConTarifaResponseSchema,
  solicitudResponseSchema,
  type CrearSolicitudRequest,
  type EstimadoResponse,
  type EstimarViajeRequest,
  type SolicitudResponse,
} from '@viaticos/contracts';

export interface SolicitudesApi {
  destinosDisponibles(): Promise<string[]>;
  estimar(datos: EstimarViajeRequest, signal?: AbortSignal): Promise<EstimadoResponse>;
  crear(datos: CrearSolicitudRequest): Promise<SolicitudResponse>;
  misSolicitudes(): Promise<SolicitudResponse[]>;
  obtener(id: string): Promise<SolicitudResponse>;
  pendientesDeAprobar(): Promise<SolicitudResponse[]>;
  aprobar(id: string, comentario?: string): Promise<SolicitudResponse>;
  rechazar(id: string, comentario: string): Promise<SolicitudResponse>;
  cancelar(id: string): Promise<SolicitudResponse>;
}

const listaSolicitudes = z.array(solicitudResponseSchema);

/** Las respuestas se validan contra el contrato: un cambio incompatible en la API falla aquí, no en la UI. */
export const crearSolicitudesApi = (http: AxiosInstance): SolicitudesApi => ({
  destinosDisponibles: async () =>
    paisesConTarifaResponseSchema.parse((await http.get('/solicitudes/destinos-disponibles')).data).paises,
  estimar: async (datos, signal) =>
    estimadoResponseSchema.parse((await http.post('/solicitudes/estimar', datos, { signal })).data),
  crear: async (datos) => solicitudResponseSchema.parse((await http.post('/solicitudes', datos)).data),
  misSolicitudes: async () => listaSolicitudes.parse((await http.get('/solicitudes')).data),
  obtener: async (id) => solicitudResponseSchema.parse((await http.get(`/solicitudes/${encodeURIComponent(id)}`)).data),
  pendientesDeAprobar: async () => listaSolicitudes.parse((await http.get('/aprobaciones/pendientes')).data),
  aprobar: async (id, comentario) =>
    solicitudResponseSchema.parse((await http.post(`/solicitudes/${encodeURIComponent(id)}/aprobar`, { comentario })).data),
  rechazar: async (id, comentario) =>
    solicitudResponseSchema.parse((await http.post(`/solicitudes/${encodeURIComponent(id)}/rechazar`, { comentario })).data),
  cancelar: async (id) =>
    solicitudResponseSchema.parse((await http.post(`/solicitudes/${encodeURIComponent(id)}/cancelar`, {})).data),
});
