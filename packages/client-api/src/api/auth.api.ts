import type { AxiosInstance } from 'axios';
import type { ConfiguracionMfa, Empleado, Login, RespuestaLogin, Tokens } from '@viaticos/contracts';

export type Perfil = Empleado & { mfa_setup_required: boolean; supported_currencies: string[] };

export interface AuthApi {
  /** Paso 1. Si el usuario tiene MFA, no trae tokens sino `mfa_token`. */
  login(datos: Login): Promise<RespuestaLogin>;
  /** Paso 2: código de la app autenticadora o de recuperación. */
  verificarMfa(mfaToken: string, codigo: string): Promise<RespuestaLogin>;
  renovar(refreshToken: string): Promise<Tokens>;
  logout(refreshToken: string): Promise<void>;
  perfil(): Promise<Perfil>;
  cambiarClave(actual: string, nueva: string): Promise<void>;
  iniciarMfa(): Promise<ConfiguracionMfa>;
  /** Devuelve los códigos de recuperación (se muestran una sola vez). Cierra las sesiones abiertas. */
  activarMfa(codigo: string): Promise<string[]>;
}

export const crearAuthApi = (http: AxiosInstance): AuthApi => ({
  login: async (datos) => (await http.post<RespuestaLogin>('/auth/login', datos)).data,
  verificarMfa: async (mfaToken, codigo) => (await http.post<RespuestaLogin>('/auth/mfa', { mfa_token: mfaToken, code: codigo })).data,
  renovar: async (refreshToken) => (await http.post<Tokens>('/auth/refresh', { refresh_token: refreshToken })).data,
  logout: async (refreshToken) => {
    await http.post('/auth/logout', { refresh_token: refreshToken });
  },
  perfil: async () => (await http.get<Perfil>('/me')).data,
  cambiarClave: async (actual, nueva) => {
    await http.post('/me/password', { current_password: actual, new_password: nueva });
  },
  iniciarMfa: async () => (await http.post<ConfiguracionMfa>('/me/mfa/setup')).data,
  activarMfa: async (codigo) => (await http.post<{ recovery_codes: string[] }>('/me/mfa/enable', { code: codigo })).data.recovery_codes,
});
