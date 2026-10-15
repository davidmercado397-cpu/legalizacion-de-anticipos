import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ApiError } from '@viaticos/client-api';
import { useQuery } from '@tanstack/react-query';
import { anticipoOptions, legalizacionPorAnticipoOptions, useApi } from '@viaticos/client-app';
import { EnlaceLegalizacion, InsigniaEstadoLegalizacion } from '../../../features/legalizaciones/componentes';
import { InsigniaEstadoAnticipo, resumenViaje } from '../../../features/anticipos/componentes';
import { t } from '../../../i18n';
import { mensajeDeError } from '../../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../../lib/formato';
import { Alerta, Cargando, EstadoVacio, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/anticipos/$anticipoId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(anticipoOptions(context.api, params.anticipoId)),
  pendingComponent: () => <Cargando />,
  errorComponent: ({ error }) =>
    error instanceof ApiError && error.status === 404 ? (
      <EstadoVacio titulo="Anticipo no encontrado" />
    ) : (
      <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>
    ),
  component: DetalleAnticipo,
});

function DetalleAnticipo() {
  const api = useApi();
  const { anticipoId } = Route.useParams();
  const { data: a } = useSuspenseQuery(anticipoOptions(api, anticipoId));
  const legalizacion = useQuery({ ...legalizacionPorAnticipoOptions(api, anticipoId), enabled: a.estado === 'DESEMBOLSADO' || a.estado === 'LEGALIZADO' });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/anticipos" className="text-sm text-marca-700 hover:underline">
            ← Mis anticipos
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{a.viaje.motivo}</h1>
          <p className="text-sm text-slate-600">
            {a.viajeroNombre} · {resumenViaje(a)}
          </p>
        </div>
        <InsigniaEstadoAnticipo estado={a.estado} />
      </div>

      <Tarjeta className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-sm text-slate-500">Monto del anticipo</p>
          <p className="text-2xl font-bold">{formatoDinero(a.monto)}</p>
        </div>
        <div>
          <p className="text-sm text-slate-500">Registro en ERP</p>
          <p className="font-medium">{a.erp.referencia ?? 'Pendiente'}</p>
        </div>
        <div>
          <p className="text-sm text-slate-500">Desembolso</p>
          {a.desembolso ? (
            <p className="font-medium">
              {formatoFechaCalendario(a.desembolso.fecha)} · {t(`medio.${a.desembolso.medio}`)}
              {a.desembolso.referencia && <span className="block text-sm text-slate-500">Ref. {a.desembolso.referencia}</span>}
            </p>
          ) : (
            <p className="font-medium">Pendiente de tesorería</p>
          )}
        </div>
      </Tarjeta>

      {legalizacion.data && (
        <Tarjeta className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Legalización</p>
            <p className="text-sm text-slate-600">
              {legalizacion.data.soportes.length} soporte(s) · <InsigniaEstadoLegalizacion estado={legalizacion.data.estado} />
            </p>
          </div>
          <EnlaceLegalizacion id={legalizacion.data.id}>{legalizacion.data.editable ? 'Legalizar gastos' : 'Ver legalización'}</EnlaceLegalizacion>
        </Tarjeta>
      )}

      <Link to="/solicitudes/$solicitudId" params={{ solicitudId: a.solicitudId }} className="inline-block text-sm text-marca-700 hover:underline">
        Ver la solicitud de viaje →
      </Link>
    </div>
  );
}
