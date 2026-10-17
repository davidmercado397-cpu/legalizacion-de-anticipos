import { createFileRoute } from '@tanstack/react-router';
import { usePendientesDeAprobar } from '@viaticos/client-app';
import { ListaAnticipos } from '../../features/anticipos/componentes';
import { CorreccionesPorValidar } from '../../features/gastos/aprendizaje';
import { mensajeDeError } from '../../lib/errores';
import { exigir } from '../../lib/roles';
import { Alerta, Cargando } from '../../ui/superficies';

export const Route = createFileRoute('/_app/aprobaciones')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'aprobar'),
  component: Aprobaciones,
});

/** El jefe aprueba la solicitud; la legalización la revisa contabilidad. */
function Aprobaciones() {
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Aprobaciones</h1>
      <Bandeja />
      <CorreccionesPorValidar />
    </div>
  );
}

/** Lo que le toca decidir: su paso de la ruta, o el de nivel superior que puede aprobar sin esperar. */
function Bandeja() {
  const { data, isPending, error } = usePendientesDeAprobar();
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-slate-700">Solicitudes por aprobar</h2>
      {isPending ? (
        <Cargando />
      ) : error ? (
        <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>
      ) : (
        <ListaAnticipos anticipos={data} mostrarEmpleado vacio="No hay solicitudes esperando su aprobación" />
      )}
    </section>
  );
}
