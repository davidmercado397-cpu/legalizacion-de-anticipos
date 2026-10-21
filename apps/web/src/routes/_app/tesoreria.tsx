import { createFileRoute } from '@tanstack/react-router';
import { useAnticipos } from '@viaticos/client-app';
import type { FiltrosAnticipos } from '@viaticos/client-api';
import { ListaAnticipos } from '../../features/anticipos/componentes';
import { exigir } from '../../lib/roles';
import { EstadoConsulta } from '../../ui/estado-consulta';
import { EncabezadoPagina, Seccion } from '../../ui/pagina';

export const Route = createFileRoute('/_app/tesoreria')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'tesoreria'),
  component: Tesoreria,
});

function Tesoreria() {
  return (
    <div className="space-y-10">
      <EncabezadoPagina titulo="Tesorería" descripcion="Lo que falta entregar y las diferencias por liquidar." />
      <Bandeja titulo="Por desembolsar" filtros={{ status: 'approved', disbursed: false }} vacio="No hay anticipos por desembolsar" />
      <Bandeja titulo="Diferencias por liquidar" filtros={{ settlement: 'pending' }} vacio="No hay reintegros ni reembolsos pendientes" />
    </div>
  );
}

function Bandeja({ titulo, filtros, vacio }: { titulo: string; filtros: FiltrosAnticipos; vacio: string }) {
  const consulta = useAnticipos({ ...filtros, limit: 100 });
  return (
    <Seccion titulo={titulo} contador={consulta.data?.data.length}>
      <EstadoConsulta consulta={consulta}>
        {(pagina) => <ListaAnticipos anticipos={pagina.data} mostrarEmpleado vacio={vacio} />}
      </EstadoConsulta>
    </Seccion>
  );
}
