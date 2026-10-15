import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { FormularioLogin } from '../features/sesion/formulario-login';

/** Solo rutas internas: evita redirecciones abiertas a sitios externos. */
const rutaInterna = z
  .string()
  .refine((r) => r.startsWith('/') && !r.startsWith('//'))
  .optional()
  .catch(undefined);

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: rutaInterna }),
  beforeLoad: ({ context, search }) => {
    if (context.sesion.getState().estado === 'autenticada') throw redirect({ to: search.redirect ?? '/solicitudes' });
  },
  component: PaginaLogin,
});

function PaginaLogin() {
  const { redirect: destino } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-marca-50 to-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto size-12" />
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Viáticos</h1>
          <p className="text-sm text-slate-600">Legalización de anticipos de viaje</p>
        </div>
        <FormularioLogin alIngresar={() => navigate({ to: destino ?? '/solicitudes' })} />
      </div>
    </main>
  );
}
