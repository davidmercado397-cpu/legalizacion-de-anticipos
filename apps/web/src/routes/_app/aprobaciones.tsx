import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { pendientesOptions, useApi } from '@viaticos/client-app';
import { TarjetaSolicitud } from '../../features/solicitudes/componentes';
import { Cargando, EstadoVacio } from '../../ui/superficies';

export const Route = createFileRoute('/_app/aprobaciones')({
  loader: ({ context }) => context.queryClient.ensureQueryData(pendientesOptions(context.api)),
  pendingComponent: () => <Cargando />,
  component: Bandeja,
});

function Bandeja() {
  const api = useApi();
  const { data } = useSuspenseQuery(pendientesOptions(api));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Aprobaciones pendientes</h1>
      {data.length === 0 ? (
        <EstadoVacio titulo="No tiene solicitudes por aprobar" />
      ) : (
        <ul className="space-y-3">
          {data.map((s) => (
            <li key={s.id}>
              <TarjetaSolicitud solicitud={s} mostrarViajero />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
