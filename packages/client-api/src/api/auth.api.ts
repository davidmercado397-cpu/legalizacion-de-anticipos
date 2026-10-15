import type { AxiosInstance } from 'axios';
import { sesionResponseSchema, usuarioSesionSchema, type LoginRequest, type SesionResponse, type UsuarioSesion } from '@viaticos/contracts';

export interface AuthApi {
  login(datos: LoginRequest): Promise<SesionResponse>;
  renovar(): Promise<SesionResponse>;
  logout(): Promise<void>;
  perfil(): Promise<UsuarioSesion>;
}

export const crearAuthApi = (http: AxiosInstance): AuthApi => ({
  login: async (datos) => sesionResponseSchema.parse((await http.post('/auth/login', datos)).data),
  renovar: async () => sesionResponseSchema.parse((await http.post('/auth/refresh', {})).data),
  logout: async () => {
    await http.post('/auth/logout', {});
  },
  perfil: async () => usuarioSesionSchema.parse((await http.get('/auth/me')).data),
});
