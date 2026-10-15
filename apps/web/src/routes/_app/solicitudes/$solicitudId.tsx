import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ApiError } from '@viaticos/client-api';
import { puedeCancelar, puedeDecidir, solicitudOptions, useApi, useCancelarSolicitud, useSesion } from '@viaticos/client-app';
import {
  AvisoEscalamiento,
  InsigniaEstado,
  LineaTiempoAprobacion,
  TablaPresupuesto,
} from '../../../features/solicitudes/componentes';
import { PanelDecision } from '../../../features/solicitudes/panel-decision';
import { mensajeDeError } from '../../../lib/errores';
import { formatoMomento } from '../../../lib/formato';
import { Boton } from '../../../ui/boton';
import { Alerta, Cargando, EstadoVacio, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/solicitudes/$solicitudId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(solicitudOptions(context.api, params.solicitudId)),
  pendingComponent: () => <Cargando />,
  errorComponent: ({ error }) =>
    error instanceof ApiError && error.status === 404 ? (
      <EstadoVacio titulo="Solicitud no encontrada">
        <Link to="/solicitudes" className="font-semibold text-marca-700 underline">
          Ver mis solicitudes
        </Link>
      </EstadoVacio>
    ) : (
      <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>
    ),
  component: DetalleSolicitud,
});

function DetalleSolicitud() {
  const api = useApi();
  const { solicitudId } = Route.useParams();
  const { data: s } = useSuspenseQuery(solicitudOptions(api, solicitudId));
  const usuarioId = useSesion((x) => x.usuario?.id);
  const cancelar = useCancelarSolicitud();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/solicitudes" className="text-sm text-marca-700 hover:underline">
            ← Volver
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{s.motivo}</h1>
          <p className="text-sm text-slate-600">
            {s.viajeroNombre} · creada {formatoMomento(s.creadaEn)}
          </p>
        </div>
        <InsigniaEstado estado={s.estado} />
      </div>

      {puedeDecidir(s, usuarioId) && <PanelDecision solicitudId={s.id} />}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Tarjeta className="space-y-4">
          <h2 className="text-lg font-semibold">Presupuesto</h2>
          <TablaPresupuesto presupuesto={s.presupuesto} destinos={s.destinos} />
          <AvisoEscalamiento escalamiento={s.escalamiento} />
          {s.justificacion && (
            <div>
              <p className="text-sm font-semibold text-slate-700">Justificación del viajero</p>
              <p className="mt-1 text-sm text-slate-700">{s.justificacion}</p>
            </div>
          )}
        </Tarjeta>
        <Tarjeta className="space-y-4 self-start">
          <h2 className="text-lg font-semibold">Aprobaciones</h2>
          <LineaTiempoAprobacion ruta={s.ruta} />
          {puedeCancelar(s, usuarioId) && (
            <>
              {cancelar.isError && <Alerta tono="peligro">{mensajeDeError(cancelar.error)}</Alerta>}
              <Boton
                variante="secundario"
                className="w-full"
                cargando={cancelar.isPending}
                onClick={() => window.confirm('¿Cancelar esta solicitud?') && cancelar.mutate(s.id)}
              >
                Cancelar solicitud
              </Boton>
            </>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
