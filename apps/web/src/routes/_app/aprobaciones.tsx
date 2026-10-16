import { createFileRoute } from '@tanstack/react-router';
import { useAnticipos, useSesion } from '@viaticos/client-app';
import type { EstadoAnticipo } from '@viaticos/contracts';
import { ListaAnticipos } from '../../features/anticipos/componentes';
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
      <Bandeja titulo="Solicitudes por aprobar" estado="requested" vacio="No hay solicitudes esperando su aprobación" />
    </div>
  );
}

/** Lo que el usuario puede ver en ese estado, menos lo propio (nadie decide sobre lo suyo). */
function Bandeja({ titulo, estado, vacio }: { titulo: string; estado: EstadoAnticipo; vacio: string }) {
  const usuarioId = useSesion((s) => s.usuario?.id);
  const { data, isPending, error } = useAnticipos({ status: estado, limit: 100 });
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-slate-700">{titulo}</h2>
      {isPending ? (
        <Cargando />
      ) : error ? (
        <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>
      ) : (
        <ListaAnticipos anticipos={data.data.filter((a) => a.employee_id !== usuarioId)} mostrarEmpleado vacio={vacio} />
      )}
    </section>
  );
}
