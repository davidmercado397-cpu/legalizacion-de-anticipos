import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ApiError } from '@viaticos/client-api';
import { extractoOptions, useApi, useSesion } from '@viaticos/client-app';
import { VistaExtracto } from '../../../features/conciliacion/vista-extracto';
import { mensajeDeError } from '../../../lib/errores';
import { Alerta, Cargando, EstadoVacio } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/conciliacion/$extractoId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(extractoOptions(context.api, params.extractoId)),
  pendingComponent: () => <Cargando />,
  errorComponent: ({ error }) =>
    error instanceof ApiError && error.status === 404 ? <EstadoVacio titulo="Extracto no encontrado" /> : <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>,
  component: PaginaExtracto,
});

function PaginaExtracto() {
  const api = useApi();
  const { extractoId } = Route.useParams();
  const { data } = useSuspenseQuery(extractoOptions(api, extractoId));
  const esContabilidad = useSesion((s) => s.usuario?.roles.includes('CONTABILIDAD') ?? false);
  return (
    <div className="space-y-3">
      <Link to="/legalizaciones/$legalizacionId" params={{ legalizacionId: data.legalizacionId }} className="text-sm text-marca-700 hover:underline">
        ← Volver a la legalización
      </Link>
      {!esContabilidad && <Alerta tono="info">Contabilidad revisará los cargos que no tienen factura.</Alerta>}
      <VistaExtracto extracto={data} puedeDecidir={esContabilidad} />
    </div>
  );
}
