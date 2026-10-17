import { createFileRoute } from '@tanstack/react-router';
import { Companias } from '../../../features/administracion/companias';
import { Empleados } from '../../../features/administracion/empleados';

export const Route = createFileRoute('/_app/administracion/')({ component: UsuariosYCompanias });

function UsuariosYCompanias() {
  return (
    <div className="space-y-8">
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
