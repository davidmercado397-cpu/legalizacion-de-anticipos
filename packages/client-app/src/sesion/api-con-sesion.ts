import { crearApi, type Api } from '@viaticos/client-api';
import type { RespuestaLogin } from '@viaticos/contracts';
import type { SesionStore } from './sesion.store';

/** Conecta el cliente HTTP con el store de sesión: token en cada petición y renovación con el refresh token. */
export function crearApiConSesion(opciones: { baseURL: string; idioma?: () => string }, store: SesionStore): Api {
  const api: Api = crearApi({
    ...opciones,
    sesion: {
      accessToken: () => store.getState().accessToken,
      renovar: async () => {
        const refresh = store.getState().refreshToken();
        if (!refresh) return null;
        try {
          const tokens = await api.auth.renovar(refresh);
          store.getState().establecerTokens(tokens.access_token, tokens.refresh_token);
          return tokens.access_token;
        } catch {
          store.getState().limpiar();
          return null;
        }
      },
      expirada: () => store.getState().limpiar(),
    },
  });
  return api;
}

/** Guarda los tokens de un login (o del paso de MFA) y carga el perfil; si pide MFA, deja el reto pendiente. */
export async function aplicarLogin(api: Api, store: SesionStore, respuesta: RespuestaLogin): Promise<void> {
  if (respuesta.mfa_required && respuesta.mfa_token) {
    store.getState().pedirMfa(respuesta.mfa_token);
    return;
  }
  if (!respuesta.access_token || !respuesta.refresh_token) throw new Error('La API no entregó los tokens de la sesión');
  store.getState().establecerTokens(respuesta.access_token, respuesta.refresh_token);
  store.getState().establecerUsuario(await api.auth.perfil());
}

/** Al abrir la app: si hay un refresh token guardado y sigue vigente, se recupera la sesión sin pedir login. */
export async function restaurarSesion(api: Api, store: SesionStore): Promise<void> {
  const refresh = store.getState().refreshToken();
  if (!refresh) {
    store.getState().limpiar();
    return;
  }
  try {
    const tokens = await api.auth.renovar(refresh);
    store.getState().establecerTokens(tokens.access_token, tokens.refresh_token);
    store.getState().establecerUsuario(await api.auth.perfil());
  } catch {
    store.getState().limpiar();
  }
}
