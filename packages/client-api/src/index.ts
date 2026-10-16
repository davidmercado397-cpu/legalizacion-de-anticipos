import type { AxiosInstance } from 'axios';
import { crearAnticiposApi, type AnticiposApi } from './api/anticipos.api';
import { crearConciliacionApi, type ConciliacionApi } from './api/conciliacion.api';
import { crearAuthApi, type AuthApi } from './api/auth.api';
import { crearLegalizacionesApi, type LegalizacionesApi } from './api/legalizaciones.api';
import { crearSolicitudesApi, type SolicitudesApi } from './api/solicitudes.api';
import { crearTasasApi, type TasasApi } from './api/tasas.api';
import { crearClienteHttp, type OpcionesClienteHttp } from './http';

export { ApiError } from './errores';
export { crearClienteHttp, type OpcionesClienteHttp, type PuertoSesion } from './http';
export type { AnticiposApi } from './api/anticipos.api';
export type { AuthApi } from './api/auth.api';
export type { ConciliacionApi, DatosCargaExtracto } from './api/conciliacion.api';
export type { ArchivoParaSubir, LegalizacionesApi } from './api/legalizaciones.api';
export type { SolicitudesApi } from './api/solicitudes.api';
export type { TasasApi } from './api/tasas.api';

export interface Api {
  auth: AuthApi;
  solicitudes: SolicitudesApi;
  anticipos: AnticiposApi;
  legalizaciones: LegalizacionesApi;
  tasas: TasasApi;
  conciliacion: ConciliacionApi;
}

export function crearApi(opciones: OpcionesClienteHttp): Api {
  const http: AxiosInstance = crearClienteHttp(opciones);
  return { auth: crearAuthApi(http), solicitudes: crearSolicitudesApi(http), anticipos: crearAnticiposApi(http), legalizaciones: crearLegalizacionesApi(http), tasas: crearTasasApi(http), conciliacion: crearConciliacionApi(http) };
}
