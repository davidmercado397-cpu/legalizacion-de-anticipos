import { Link } from '@tanstack/react-router';
import { pendienteDe, usePendientesDeAprobar, useSesion } from '@viaticos/client-app';
import { puede } from '../../lib/roles';
import { MenuUsuario } from './menu-usuario';
import { GRUPOS, type EnlaceNav } from './navegacion';

const ENLACE =
  'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 [&_svg]:size-[18px] [&_svg]:shrink-0';
const ACTIVO = 'bg-white text-slate-900 shadow-[0_1px_2px_rgb(11_16_32/0.06)] ring-1 ring-slate-200 hover:bg-white [&_svg]:text-marca-600';

/** Logo, secciones según el rol y el usuario abajo. La misma en escritorio y en el cajón del móvil. */
export function BarraLateral({ alNavegar }: { alNavegar?: () => void }) {
  const usuario = useSesion((s) => s.usuario);
  // Mientras falte cambiar la clave o activar el MFA no hay a dónde más ir.
  const grupos = pendienteDe(usuario)
    ? []
    : GRUPOS.map((g) => ({ ...g, enlaces: g.enlaces.filter((e) => puede(usuario, e.capacidad)) })).filter((g) => g.enlaces.length > 0);

  return (
    <div className="flex h-full flex-col px-3.5 py-5">
      <Link to="/" aria-label="nextv.ia: inicio" className="mb-3 flex items-center px-2.5" onClick={alNavegar}>
        <img src="/marca/logo.svg" alt="" className="h-7 w-auto" />
      </Link>
      <nav aria-label="Principal" className="flex-1 overflow-y-auto">
        {grupos.map((g) => (
          <div key={g.titulo}>
            <p className="px-2.5 pt-5 pb-1.5 text-xs font-semibold text-slate-500">{g.titulo}</p>
            <ul className="space-y-0.5">
              {g.enlaces.map((e) => (
                <li key={e.texto}>
                  <Enlace enlace={e} alNavegar={alNavegar} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="mt-4">
        <MenuUsuario {...(alNavegar ? { alElegir: alNavegar } : {})} />
      </div>
    </div>
  );
}

function Enlace({ enlace: { to, texto, icono: Icono, exacta }, alNavegar }: { enlace: EnlaceNav; alNavegar?: (() => void) | undefined }) {
  return (
    <Link
      to={to}
      onClick={alNavegar}
      className={ENLACE}
      activeOptions={{ exact: exacta ?? false }}
      activeProps={{ className: ACTIVO, 'aria-current': 'page' }}
    >
      <Icono aria-hidden />
      {texto}
      {to === '/aprobaciones' && <PorAprobar />}
    </Link>
  );
}

/** Cuántas solicitudes esperan al usuario: lo único que la barra cuenta, porque es lo que bloquea a otros. */
function PorAprobar() {
  const total = usePendientesDeAprobar().data?.length ?? 0;
  if (total === 0) return null;
  return (
    <span className="ml-auto rounded-full bg-marca-100 px-2 text-xs font-bold text-marca-800 tabular-nums">
      {total}
      <span className="sr-only"> por aprobar</span>
    </span>
  );
}
