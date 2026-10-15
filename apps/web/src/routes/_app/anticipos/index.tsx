import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { misAnticiposOptions, useApi } from '@viaticos/client-app';
import { TarjetaAnticipo } from '../../../features/anticipos/componentes';
import { Cargando, EstadoVacio } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/anticipos/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(misAnticiposOptions(context.api)),
  pendingComponent: () => <Cargando />,
  component: MisAnticipos,
});

function MisAnticipos() {
  const api = useApi();
  const { data } = useSuspenseQuery(misAnticiposOptions(api));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mis anticipos</h1>
      {data.length === 0 ? (
        <EstadoVacio titulo="Aún no tiene anticipos">Se crean automáticamente cuando aprueban una solicitud de viaje.</EstadoVacio>
      ) : (
        <ul className="space-y-3">
          {data.map((a) => (
            <li key={a.id}>
              <TarjetaAnticipo anticipo={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
