import { createRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';
import type { Dependencias } from './dependencias';

export type ContextoRouter = Dependencias;

export function crearRouter(contexto: ContextoRouter) {
  return createRouter({
    routeTree,
    context: contexto,
    defaultPreload: 'intent',
    // Los datos los cachea TanStack Query; el router siempre consulta la caché.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof crearRouter>;
  }
}
