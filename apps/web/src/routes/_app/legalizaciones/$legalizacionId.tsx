import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ApiError } from '@viaticos/client-api';
import { legalizacionOptions, useApi, useSesion } from '@viaticos/client-app';
import { VistaLegalizacion } from '../../../features/legalizaciones/vista-legalizacion';
import { mensajeDeError } from '../../../lib/errores';
import { Alerta, Cargando, EstadoVacio } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/legalizaciones/$legalizacionId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(legalizacionOptions(context.api, params.legalizacionId)),
  pendingComponent: () => <Cargando />,
  errorComponent: ({ error }) =>
    error instanceof ApiError && error.status === 404 ? <EstadoVacio titulo="Legalización no encontrada" /> : <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>,
  component: PaginaLegalizacion,
});

function PaginaLegalizacion() {
  const api = useApi();
  const { legalizacionId } = Route.useParams();
  const { data } = useSuspenseQuery(legalizacionOptions(api, legalizacionId));
  const usuario = useSesion((s) => s.usuario);
  const esViajero = usuario?.id === data.viajeroId;

  return (
    <div className="space-y-3">
      <Link
        to={esViajero ? '/anticipos/$anticipoId' : '/contabilidad'}
        params={{ anticipoId: data.anticipoId }}
        className="text-sm text-marca-700 hover:underline"
      >
        ← Volver
      </Link>
      <VistaLegalizacion legalizacion={data} modo={esViajero ? 'viajero' : 'contabilidad'} />
    </div>
  );
}
