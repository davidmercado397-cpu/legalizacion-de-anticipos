import { Link, Outlet, createFileRoute } from '@tanstack/react-router';
import { exigir } from '../../../lib/roles';

export const Route = createFileRoute('/_app/administracion')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'administrar'),
  component: Administracion,
});

const PESTANA = 'whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900';
const ACTIVA = { className: 'border-marca-700 text-marca-800' };

function Administracion() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Administración</h1>
        <nav aria-label="Administración" className="flex gap-1 overflow-x-auto border-b border-slate-200">
          <Link to="/administracion" className={PESTANA} activeProps={ACTIVA} activeOptions={{ exact: true }}>
            Usuarios y compañías
          </Link>
          <Link to="/administracion/auditoria" className={PESTANA} activeProps={ACTIVA}>
            Auditoría
          </Link>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
