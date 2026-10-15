import { QueryClient } from '@tanstack/react-query';
import { ApiError, type Api } from '@viaticos/client-api';
import { crearApiConSesion, crearSesionStore, type SesionStore } from '@viaticos/client-app';

/** Raíz de composición de la web: aquí se eligen las implementaciones concretas. */
export interface Dependencias {
  api: Api;
  sesion: SesionStore;
  queryClient: QueryClient;
}

export function crearDependencias(): Dependencias {
  const sesion = crearSesionStore();
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
