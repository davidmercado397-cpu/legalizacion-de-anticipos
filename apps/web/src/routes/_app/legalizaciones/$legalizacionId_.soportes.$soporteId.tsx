import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { legalizacionOptions, politicaLegalizacionOptions, useApi } from '@viaticos/client-app';
import { VistaArchivo } from '../../../features/legalizaciones/componentes';
import { FormularioConfirmacion } from '../../../features/legalizaciones/formulario-confirmacion';
import { Cargando, EstadoVacio } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/legalizaciones/$legalizacionId_/soportes/$soporteId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(legalizacionOptions(context.api, params.legalizacionId)),
  pendingComponent: () => <Cargando />,
  component: ConfirmarSoporte,
});

function ConfirmarSoporte() {
  const api = useApi();
  const navigate = Route.useNavigate();
  const { legalizacionId, soporteId } = Route.useParams();
  const { data: legalizacion } = useSuspenseQuery(legalizacionOptions(api, legalizacionId));
  const politica = useQuery(politicaLegalizacionOptions(api));
  const soporte = legalizacion.soportes.find((s) => s.id === soporteId);
  const volver = () => navigate({ to: '/legalizaciones/$legalizacionId', params: { legalizacionId } });

  if (!soporte) return <EstadoVacio titulo="El soporte ya no existe" />;
  if (soporte.estado === 'PROCESANDO') return <Cargando texto="Leyendo la factura…" />;

  return (
    <div className="space-y-4">
      <Link to="/legalizaciones/$legalizacionId" params={{ legalizacionId }} className="text-sm text-marca-700 hover:underline">
        ← Volver a la legalización
      </Link>
      <h1 className="text-2xl font-bold">Confirme los datos de la factura</h1>
      <p className="text-sm text-slate-600">“{soporte.descripcion}”</p>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <VistaArchivo legalizacionId={legalizacionId} soporte={soporte} grande />
        </div>
        <FormularioConfirmacion legalizacion={legalizacion} soporte={soporte} nitEmpresa={politica.data?.nitEmpresa} alConfirmar={() => void volver()} />
      </div>
    </div>
  );
}
