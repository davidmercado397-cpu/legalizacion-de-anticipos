import { Link, Outlet, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { pendienteDe, useSesion } from '@viaticos/client-app';
import { Menu } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { BarraLateral } from '../features/shell/barra-lateral';
import { Boton } from '../ui/boton';

const RUTA_PENDIENTE = { cambiar_clave: '/cuenta/clave', activar_mfa: '/cuenta/mfa' } as const;

/** Rutas privadas: exige sesión; si falta cambiar la clave o activar el MFA, solo deja hacer eso. */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    const { estado, usuario } = context.sesion.getState();
    if (estado !== 'autenticada') throw redirect({ to: '/login', search: { redirect: location.href } });
    const pendiente = pendienteDe(usuario);
    if (pendiente && location.pathname !== RUTA_PENDIENTE[pendiente]) throw redirect({ to: RUTA_PENDIENTE[pendiente] });
  },
  component: Layout,
});

function Layout() {
  const estado = useSesion((s) => s.estado);
  const navigate = useNavigate();
  const router = useRouter();
  const cajon = useRef<HTMLDialogElement>(null);

  // Si la sesión se cierra o expira mientras se usa la app, se vuelve al login conservando la ruta.
  useEffect(() => {
    if (estado !== 'autenticada') void navigate({ to: '/login', search: { redirect: router.state.location.href } });
  }, [estado, navigate, router]);

  const cerrarCajon = () => cajon.current?.close();

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-slate-200 bg-slate-50 lg:block">
        <BarraLateral />
      </aside>

      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 lg:hidden">
        <Boton variante="fantasma" className="-ml-2 px-2.5" aria-label="Abrir el menú" onClick={() => cajon.current?.showModal()}>
          <Menu className="size-5" aria-hidden />
        </Boton>
        <Link to="/" aria-label="nextv.ia: inicio">
          <img src="/marca/logo.svg" alt="" className="h-7 w-auto" />
        </Link>
      </header>
      <dialog
        ref={cajon}
        aria-label="Menú"
        onClick={(e) => e.target === e.currentTarget && cerrarCajon()}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-slate-50 p-0 backdrop:bg-navy-950/40 lg:hidden"
      >
        <BarraLateral alNavegar={cerrarCajon} />
      </dialog>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
