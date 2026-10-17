import { Link, Outlet, createFileRoute } from '@tanstack/react-router';
import { exigir } from '../../../lib/roles';

/** Solo el operador de la plataforma (superadmin de NextByte): costo de la IA y configuración del sistema. */
export const Route = createFileRoute('/_app/plataforma')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'plataforma'),
  component: Plataforma,
});

const PESTANA = 'whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900';
const ACTIVA = { className: 'border-marca-700 text-marca-800' };

function Plataforma() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Plataforma</h1>
        <nav aria-label="Plataforma" className="flex gap-1 overflow-x-auto border-b border-slate-200">
          <Link to="/plataforma" className={PESTANA} activeProps={ACTIVA} activeOptions={{ exact: true }}>
            Costo de la IA
          </Link>
          <Link to="/plataforma/configuracion" className={PESTANA} activeProps={ACTIVA}>
            Configuración
          </Link>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
