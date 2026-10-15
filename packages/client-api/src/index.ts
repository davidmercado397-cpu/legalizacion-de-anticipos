import type { AxiosInstance } from 'axios';
import { crearAnticiposApi, type AnticiposApi } from './api/anticipos.api';
import { crearAuthApi, type AuthApi } from './api/auth.api';
import { crearSolicitudesApi, type SolicitudesApi } from './api/solicitudes.api';
import { crearClienteHttp, type OpcionesClienteHttp } from './http';

export { ApiError } from './errores';
export { crearClienteHttp, type OpcionesClienteHttp, type PuertoSesion } from './http';
export type { AnticiposApi } from './api/anticipos.api';
export type { AuthApi } from './api/auth.api';
export type { SolicitudesApi } from './api/solicitudes.api';

export interface Api {
  auth: AuthApi;
  solicitudes: SolicitudesApi;
  anticipos: AnticiposApi;
}

export function crearApi(opciones: OpcionesClienteHttp): Api {
  const http: AxiosInstance = crearClienteHttp(opciones);
  return { auth: crearAuthApi(http), solicitudes: crearSolicitudesApi(http), anticipos: crearAnticiposApi(http) };
}
