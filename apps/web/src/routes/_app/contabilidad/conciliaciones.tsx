import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { extractosOptions, useApi } from '@viaticos/client-app';
import { ListaExtractos } from '../../../features/conciliacion/lista-extractos';
import { Cargando, EstadoVacio } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/contabilidad/conciliaciones')({
  beforeLoad: ({ context }) => {
    if (!context.sesion.getState().usuario?.roles.includes('CONTABILIDAD')) throw redirect({ to: '/solicitudes' });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(extractosOptions(context.api)),
  pendingComponent: () => <Cargando />,
  component: Conciliaciones,
});

function Conciliaciones() {
  const api = useApi();
  const { data } = useSuspenseQuery(extractosOptions(api));
  return (
    <div className="space-y-4">
      <Link to="/contabilidad" className="text-sm text-marca-700 hover:underline">
        ← Legalizaciones por revisar
      </Link>
      <h1 className="text-2xl font-bold">Conciliaciones bancarias</h1>
      <p className="text-sm text-slate-600">Extractos de tarjetas corporativas cargados recientemente. Para cargar uno nuevo, entre a la legalización del viajero.</p>
      {data.length === 0 ? <EstadoVacio titulo="Aún no se han cargado extractos" /> : <ListaExtractos extractos={data} conTitular />}
    </div>
  );
}
