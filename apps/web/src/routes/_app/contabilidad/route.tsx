import { Link, Outlet, createFileRoute } from '@tanstack/react-router';
import { exigir } from '../../../lib/roles';

export const Route = createFileRoute('/_app/contabilidad')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'contabilidad'),
  component: Contabilidad,
});

const PESTANA = 'whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900';
const ACTIVA = { className: 'border-marca-700 text-marca-800' };

function Contabilidad() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Contabilidad</h1>
        <nav aria-label="Contabilidad" className="flex gap-1 overflow-x-auto border-b border-slate-200">
          <Link to="/contabilidad" className={PESTANA} activeProps={ACTIVA} activeOptions={{ exact: true }}>
            Legalizaciones
          </Link>
          <Link to="/contabilidad/tarifas" className={PESTANA} activeProps={ACTIVA}>
            Tarifas de viaje
          </Link>
          <Link to="/contabilidad/deducibilidad" className={PESTANA} activeProps={ACTIVA}>
            Deducibilidad
          </Link>
          <Link to="/contabilidad/aprendizaje" className={PESTANA} activeProps={ACTIVA}>
            Aprendizaje
          </Link>
          <Link to="/contabilidad/politica" className={PESTANA} activeProps={ACTIVA}>
            Política de gastos
          </Link>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
