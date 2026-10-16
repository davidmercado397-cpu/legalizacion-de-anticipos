import type { AxiosInstance } from 'axios';
import { crearAnticiposApi, type AnticiposApi } from './api/anticipos.api';
import { crearAuthApi, type AuthApi } from './api/auth.api';
import { crearConciliacionApi, type ConciliacionApi } from './api/conciliacion.api';
import { crearGastosApi, type GastosApi } from './api/gastos.api';
import { crearOrganizacionApi, type OrganizacionApi } from './api/organizacion.api';
import { crearClienteHttp, type OpcionesClienteHttp } from './http';

export { ApiError } from './errores';
export { crearClienteHttp, type OpcionesClienteHttp, type PuertoSesion } from './http';
export type { AnticiposApi, FiltrosAnticipos } from './api/anticipos.api';
export type { AuthApi, Perfil } from './api/auth.api';
export type { AccionMovimiento, ArchivoExtracto, ConciliacionApi } from './api/conciliacion.api';
export type { ArchivoParaSubir, FiltrosGastos, GastosApi } from './api/gastos.api';
export type { FiltrosEmpleados, OrganizacionApi } from './api/organizacion.api';

export interface Api {
  auth: AuthApi;
  anticipos: AnticiposApi;
  gastos: GastosApi;
  conciliacion: ConciliacionApi;
  organizacion: OrganizacionApi;
}

export function crearApi(opciones: OpcionesClienteHttp): Api {
  const http: AxiosInstance = crearClienteHttp(opciones);
  return {
    auth: crearAuthApi(http),
    anticipos: crearAnticiposApi(http),
    gastos: crearGastosApi(http),
    conciliacion: crearConciliacionApi(http),
    organizacion: crearOrganizacionApi(http),
  };
}
