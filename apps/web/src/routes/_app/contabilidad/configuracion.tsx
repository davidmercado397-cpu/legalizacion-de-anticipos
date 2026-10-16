import { Link, createFileRoute } from '@tanstack/react-router';
import { exigirRol } from '../../../lib/roles';

export const Route = createFileRoute('/_app/contabilidad/configuracion')({
  beforeLoad: ({ context }) => exigirRol(context.sesion, 'CONTABILIDAD'),
  component: Configuracion,
});

const OPCIONES = [
  { to: '/contabilidad/escalamiento', titulo: 'Reglas de aprobación', detalle: 'Tolerancia sobre la tarifa y monto total que escalan al jefe directivo.' },
  { to: '/contabilidad/tarifas', titulo: 'Conceptos y tarifas', detalle: 'Conceptos de viático y tarifas por cargo, país y vigencia.' },
  { to: '/contabilidad/empresas', titulo: 'Empresas del holding', detalle: 'Nombre y NIT al que deben venir las facturas de cada empresa.' },
  { to: '/contabilidad/politica', titulo: 'Política de legalización', detalle: 'Tope de recibos de caja 222 y líneas excluidas.' },
] as const;

function Configuracion() {
  return (
    <div className="space-y-4">
      <Link to="/contabilidad" className="text-sm text-marca-700 hover:underline">
        ← Legalizaciones por revisar
      </Link>
      <h1 className="text-2xl font-bold">Configuración</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {OPCIONES.map((o) => (
          <li key={o.to}>
            <Link to={o.to} className="block h-full rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-marca-600">
              <p className="font-semibold text-marca-800">{o.titulo}</p>
              <p className="text-sm text-slate-600">{o.detalle}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
