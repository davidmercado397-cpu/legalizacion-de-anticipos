import { Outlet, createFileRoute } from '@tanstack/react-router';
import { exigir } from '../../../lib/roles';
import { EncabezadoPagina, Pestanas } from '../../../ui/pagina';

export const Route = createFileRoute('/_app/administracion')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'administrar'),
  component: Administracion,
});

function Administracion() {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <EncabezadoPagina titulo="Administración" />
        <Pestanas
          etiqueta="Administración"
          pestanas={[
            { to: '/administracion', texto: 'Usuarios y compañías', exacta: true },
            { to: '/administracion/auditoria', texto: 'Auditoría' },
          ]}
        />
      </div>
      <Outlet />
    </div>
  );
}
