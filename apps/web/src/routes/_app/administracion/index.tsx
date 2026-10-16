import { createFileRoute } from '@tanstack/react-router';
import { Companias } from '../../../features/administracion/companias';
import { Empleados } from '../../../features/administracion/empleados';
import { exigir } from '../../../lib/roles';

export const Route = createFileRoute('/_app/administracion/')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'administrar'),
  component: Administracion,
});

function Administracion() {
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Administración</h1>
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">Usuarios</h2>
        <Empleados />
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">Compañías</h2>
        <Companias />
      </section>
    </div>
  );
}
