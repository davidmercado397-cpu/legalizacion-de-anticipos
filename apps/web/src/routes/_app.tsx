import { Link, Outlet, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { useCerrarSesion, useSesion } from '@viaticos/client-app';
import { useEffect } from 'react';
import { Boton } from '../ui/boton';

/** Rutas privadas: exige sesión y comparte el layout. */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    if (context.sesion.getState().estado !== 'autenticada') {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: Layout,
});

const ENLACE = 'rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap';
const ACTIVO = { className: 'bg-marca-50 text-marca-800 hover:bg-marca-50' };

function Layout() {
  const usuario = useSesion((s) => s.usuario);
  const estado = useSesion((s) => s.estado);
  const cerrar = useCerrarSesion();
  const navigate = useNavigate();
  const router = useRouter();
  const tiene = (rol: string) => usuario?.roles.includes(rol as never) ?? false;

  // Si la sesión expira mientras se usa la app, se vuelve al login conservando la ruta actual.
  useEffect(() => {
    if (estado === 'anonima') void navigate({ to: '/login', search: { redirect: router.state.location.href } });
  }, [estado, navigate, router]);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
          <Link to="/solicitudes" className="flex items-center gap-2 font-bold text-marca-800">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="hidden sm:inline">Viáticos</span>
          </Link>
          <nav aria-label="Principal" className="flex flex-1 gap-1 overflow-x-auto">
            <Link to="/solicitudes" className={ENLACE} activeProps={ACTIVO}>
              Mis solicitudes
            </Link>
            <Link to="/anticipos" className={ENLACE} activeProps={ACTIVO}>
              Mis anticipos
            </Link>
            {tiene('APROBADOR') && (
              <Link to="/aprobaciones" className={ENLACE} activeProps={ACTIVO}>
                Aprobaciones
              </Link>
            )}
            {tiene('TESORERIA') && (
              <Link to="/tesoreria" className={ENLACE} activeProps={ACTIVO}>
                Tesorería
              </Link>
            )}
          </nav>
          <span className="hidden text-sm text-slate-600 md:inline">{usuario?.nombre}</span>
          <Boton variante="fantasma" cargando={cerrar.isPending} onClick={() => cerrar.mutate()}>
            Salir
          </Boton>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
