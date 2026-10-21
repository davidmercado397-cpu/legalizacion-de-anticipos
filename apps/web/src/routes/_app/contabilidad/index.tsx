import { createFileRoute } from '@tanstack/react-router';
import { useAnticipos } from '@viaticos/client-app';
import { ListaAnticipos } from '../../../features/anticipos/componentes';
import { EstadoConsulta } from '../../../ui/estado-consulta';
import { Seccion } from '../../../ui/pagina';

export const Route = createFileRoute('/_app/contabilidad/')({ component: Legalizaciones });

function Legalizaciones() {
  const enRevision = useAnticipos({ status: 'in_review', limit: 100 });
  const cerradas = useAnticipos({ status: 'closed', limit: 20 });

  return (
    <div className="space-y-10">
      <Seccion titulo="Legalizaciones por revisar" contador={enRevision.data?.data.length}>
        <EstadoConsulta consulta={enRevision}>
          {(pagina) => <ListaAnticipos anticipos={pagina.data} mostrarEmpleado vacio="No hay legalizaciones en revisión" />}
        </EstadoConsulta>
      </Seccion>
      <Seccion titulo="Legalizadas recientemente">
        <EstadoConsulta consulta={cerradas}>
          {(pagina) => <ListaAnticipos anticipos={pagina.data} mostrarEmpleado vacio="Todavía no hay legalizaciones cerradas" />}
        </EstadoConsulta>
      </Seccion>
    </div>
  );
}
