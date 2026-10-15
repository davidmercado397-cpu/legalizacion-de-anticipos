import { crearApi, type Api } from '@viaticos/client-api';
import type { SesionStore } from './sesion.store';

/** Conecta el cliente HTTP con el store de sesión (renovación con la cookie / almacenamiento seguro). */
export function crearApiConSesion(opciones: { baseURL: string; idioma?: () => string }, store: SesionStore): Api {
  const api: Api = crearApi({
    ...opciones,
    sesion: {
      accessToken: () => store.getState().accessToken,
      renovar: async () => {
        try {
          const sesion = await api.auth.renovar();
          store.getState().establecer(sesion);
          return sesion.accessToken;
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

/** Al abrir la app: si hay una sesión válida (refresh token), se recupera sin pedir login. */
export async function restaurarSesion(api: Api, store: SesionStore): Promise<void> {
  try {
    store.getState().establecer(await api.auth.renovar());
  } catch {
    store.getState().limpiar();
  }
}
