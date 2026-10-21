import { createFileRoute } from '@tanstack/react-router';
import { usePendientesDeAprobar } from '@viaticos/client-app';
import { ListaAnticipos } from '../../features/anticipos/componentes';
import { CorreccionesPorValidar } from '../../features/gastos/aprendizaje';
import { exigir } from '../../lib/roles';
import { EstadoConsulta } from '../../ui/estado-consulta';
import { EncabezadoPagina, Seccion } from '../../ui/pagina';

export const Route = createFileRoute('/_app/aprobaciones')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'aprobar'),
  component: Aprobaciones,
});

/** El jefe aprueba la solicitud; la legalización la revisa contabilidad. */
function Aprobaciones() {
  return (
    <div className="space-y-10">
      <EncabezadoPagina titulo="Aprobaciones" descripcion="Las solicitudes de tu equipo y las correcciones que te toca validar." />
      <Bandeja />
      <CorreccionesPorValidar />
    </div>
  );
}

/** Lo que le toca decidir: su paso de la ruta, o el de nivel superior que puede aprobar sin esperar. */
function Bandeja() {
  const consulta = usePendientesDeAprobar();
  return (
    <Seccion titulo="Solicitudes por aprobar" contador={consulta.data?.length}>
      <EstadoConsulta consulta={consulta}>
        {(anticipos) => <ListaAnticipos anticipos={anticipos} mostrarEmpleado vacio="No hay solicitudes esperando tu aprobación" />}
      </EstadoConsulta>
    </Seccion>
  );
}
