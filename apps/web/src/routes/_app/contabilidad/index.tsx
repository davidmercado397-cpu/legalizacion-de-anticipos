import { createFileRoute } from '@tanstack/react-router';
import { useAnticipos } from '@viaticos/client-app';
import { ListaAnticipos } from '../../../features/anticipos/componentes';
import { mensajeDeError } from '../../../lib/errores';
import { Alerta, Cargando } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/contabilidad/')({ component: Legalizaciones });

function Legalizaciones() {
  const enRevision = useAnticipos({ status: 'in_review', limit: 100 });
  const cerradas = useAnticipos({ status: 'closed', limit: 20 });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">Legalizaciones por revisar</h2>
        {enRevision.isPending ? (
          <Cargando />
        ) : enRevision.isError ? (
          <Alerta tono="peligro">{mensajeDeError(enRevision.error)}</Alerta>
        ) : (
          <ListaAnticipos anticipos={enRevision.data.data} mostrarEmpleado vacio="No hay legalizaciones en revisión" />
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">Legalizadas recientemente</h2>
        {cerradas.data && <ListaAnticipos anticipos={cerradas.data.data} mostrarEmpleado vacio="Todavía no hay legalizaciones cerradas" />}
      </section>
    </div>
  );
}
