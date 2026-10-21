import { Outlet, createFileRoute } from '@tanstack/react-router';
import { exigir } from '../../../lib/roles';
import { EncabezadoPagina, Pestanas } from '../../../ui/pagina';

/** Solo el operador de la plataforma (superadmin de NextByte): costo de la IA y configuración del sistema. */
export const Route = createFileRoute('/_app/plataforma')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'plataforma'),
  component: Plataforma,
});

function Plataforma() {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <EncabezadoPagina titulo="Plataforma" />
        <Pestanas
          etiqueta="Plataforma"
          pestanas={[
            { to: '/plataforma', texto: 'Costo de la IA', exacta: true },
            { to: '/plataforma/configuracion', texto: 'Configuración' },
          ]}
        />
      </div>
      <Outlet />
    </div>
  );
}
