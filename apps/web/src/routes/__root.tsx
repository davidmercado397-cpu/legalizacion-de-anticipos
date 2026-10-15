import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import type { ContextoRouter } from '../app/router';
import { EstadoVacio } from '../ui/superficies';

export const Route = createRootRouteWithContext<ContextoRouter>()({
  component: Outlet,
  notFoundComponent: () => (
    <main className="mx-auto max-w-md p-6">
      <EstadoVacio titulo="Página no encontrada">
        <Link to="/" className="font-semibold text-marca-700 underline">
          Volver al inicio
        </Link>
      </EstadoVacio>
    </main>
  ),
});
