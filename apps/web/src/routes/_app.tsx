import { Link, Outlet, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { pendienteDe, useCerrarSesion, useSesion } from '@viaticos/client-app';
import { useEffect } from 'react';
import { etiqueta } from '../i18n';
import { puede } from '../lib/roles';
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

const ENLACE = 'rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap';
const ACTIVO = { className: 'bg-marca-50 text-marca-800 hover:bg-marca-50' };

function Layout() {
  const usuario = useSesion((s) => s.usuario);
  const estado = useSesion((s) => s.estado);
  const cerrar = useCerrarSesion();
  const navigate = useNavigate();
  const router = useRouter();
  const pendiente = pendienteDe(usuario);

  // Si la sesión se cierra o expira mientras se usa la app, se vuelve al login conservando la ruta.
  useEffect(() => {
    if (estado !== 'autenticada') void navigate({ to: '/login', search: { redirect: router.state.location.href } });
  }, [estado, navigate, router]);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
          <Link to="/" aria-label="nextv.ia: inicio" className="flex shrink-0 items-center">
            <img src="/marca/icono.svg" alt="" className="size-8 sm:hidden" />
            <img src="/marca/logo.svg" alt="" className="hidden h-8 w-auto sm:block" />
          </Link>
          <nav aria-label="Principal" className="flex flex-1 gap-1 overflow-x-auto">
            {!pendiente && usuario?.role !== 'superadmin' && (
              <>
                <Link to="/anticipos" className={ENLACE} activeProps={ACTIVO} activeOptions={{ exact: true }}>
                  Mis anticipos
                </Link>
                {puede(usuario, 'aprobar') && (
                  <Link to="/aprobaciones" className={ENLACE} activeProps={ACTIVO}>
                    Aprobaciones
                  </Link>
                )}
                {puede(usuario, 'contabilidad') && (
                  <Link to="/contabilidad" className={ENLACE} activeProps={ACTIVO}>
                    Contabilidad
                  </Link>
                )}
                {puede(usuario, 'tesoreria') && (
                  <Link to="/tesoreria" className={ENLACE} activeProps={ACTIVO}>
                    Tesorería
                  </Link>
                )}
                {puede(usuario, 'administrar') && (
                  <Link to="/administracion" className={ENLACE} activeProps={ACTIVO}>
                    Administración
                  </Link>
                )}
              </>
            )}
            {!pendiente && puede(usuario, 'plataforma') && (
              <Link to="/plataforma" className={ENLACE} activeProps={ACTIVO}>
                Plataforma
              </Link>
            )}
          </nav>
          <Link to="/cuenta/clave" className="hidden text-right text-sm leading-tight text-slate-600 hover:text-slate-900 md:block">
            {usuario?.full_name}
            <span className="block text-xs text-slate-400">{etiqueta('rol', usuario?.role)}</span>
          </Link>
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
