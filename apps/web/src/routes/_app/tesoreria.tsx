import { createFileRoute } from '@tanstack/react-router';
import { useAnticipos } from '@viaticos/client-app';
import type { FiltrosAnticipos } from '@viaticos/client-api';
import { ListaAnticipos } from '../../features/anticipos/componentes';
import { mensajeDeError } from '../../lib/errores';
import { exigir } from '../../lib/roles';
import { Alerta, Cargando } from '../../ui/superficies';

export const Route = createFileRoute('/_app/tesoreria')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'contabilidad'),
  component: Tesoreria,
});

function Tesoreria() {
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Tesorería</h1>
      <Seccion titulo="Por desembolsar" filtros={{ status: 'approved', disbursed: false }} vacio="No hay anticipos por desembolsar" />
      <Seccion titulo="Diferencias por liquidar" filtros={{ settlement: 'pending' }} vacio="No hay reintegros ni reembolsos pendientes" />
    </div>
  );
}

function Seccion({ titulo, filtros, vacio }: { titulo: string; filtros: FiltrosAnticipos; vacio: string }) {
  const { data, isPending, error } = useAnticipos({ ...filtros, limit: 100 });
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-slate-700">{titulo}</h2>
      {isPending ? (
        <Cargando />
      ) : error ? (
        <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>
      ) : (
        <ListaAnticipos anticipos={data.data} mostrarEmpleado vacio={vacio} />
      )}
    </section>
  );
}
