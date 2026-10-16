import { QueryClient } from '@tanstack/react-query';
import { ApiError, type Api } from '@viaticos/client-api';
import { crearApiConSesion, crearSesionStore, type AlmacenSesion, type SesionStore } from '@viaticos/client-app';

/** Raíz de composición de la web: aquí se eligen las implementaciones concretas. */
export interface Dependencias {
  api: Api;
  sesion: SesionStore;
  queryClient: QueryClient;
}

const CLAVE = 'viaticos.sesion';

/**
 * El refresh token se guarda en localStorage para no pedir login en cada visita (la API lo rota en cada
 * uso y revoca la familia si alguien reutiliza uno viejo). El access token vive solo en memoria.
 */
const almacenNavegador: AlmacenSesion = {
  leer: () => {
    try {
      return localStorage.getItem(CLAVE);
    } catch {
      return null;
    }
  },
  guardar: (valor) => {
    try {
      if (valor) localStorage.setItem(CLAVE, valor);
      else localStorage.removeItem(CLAVE);
    } catch {
      // Sin almacenamiento (modo privado estricto): la sesión dura lo que la pestaña.
    }
  },
};

export function crearDependencias(): Dependencias {
  const sesion = crearSesionStore(almacenNavegador);
  const api = crearApiConSesion({ baseURL: '/api/v1', idioma: () => navigator.language || 'es' }, sesion);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // No reintentar errores de negocio o autorización: solo fallas de red/servidor.
        retry: (intentos, error) => intentos < 2 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
      },
    },
  });
  return { api, sesion, queryClient };
}
