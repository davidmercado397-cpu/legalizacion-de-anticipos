import { createFileRoute } from '@tanstack/react-router';
import { Companias } from '../../../features/administracion/companias';
import { Empleados } from '../../../features/administracion/empleados';

export const Route = createFileRoute('/_app/administracion/')({ component: UsuariosYCompanias });

function UsuariosYCompanias() {
  return (
    <div className="space-y-12">
      <Empleados />
      <Companias />
    </div>
  );
}
