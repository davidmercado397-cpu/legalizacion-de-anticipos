import { Outlet, createFileRoute } from '@tanstack/react-router';
import { exigir } from '../../../lib/roles';
import { EncabezadoPagina, Pestanas } from '../../../ui/pagina';

export const Route = createFileRoute('/_app/contabilidad')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'contabilidad'),
  component: Contabilidad,
});

function Contabilidad() {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <EncabezadoPagina titulo="Contabilidad" />
        <Pestanas
          etiqueta="Contabilidad"
          pestanas={[
            { to: '/contabilidad', texto: 'Legalizaciones', exacta: true },
            { to: '/contabilidad/tarifas', texto: 'Tarifas de viaje' },
            { to: '/contabilidad/deducibilidad', texto: 'Deducibilidad' },
            { to: '/contabilidad/aprendizaje', texto: 'Aprendizaje' },
            { to: '/contabilidad/reportes', texto: 'Reportes' },
            { to: '/contabilidad/politica', texto: 'Política de gastos' },
          ]}
        />
      </div>
      <Outlet />
    </div>
  );
}
