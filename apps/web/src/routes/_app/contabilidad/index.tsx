import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { bandejaContabilidadOptions, useApi } from '@viaticos/client-app';
import { InsigniaEstadoLegalizacion } from '../../../features/legalizaciones/componentes';
import { formatoDinero, formatoFechaCalendario } from '../../../lib/formato';
import { Cargando, EstadoVacio, Insignia } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/contabilidad/')({
  beforeLoad: ({ context }) => {
    if (!context.sesion.getState().usuario?.roles.includes('CONTABILIDAD')) throw redirect({ to: '/solicitudes' });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(bandejaContabilidadOptions(context.api)),
  pendingComponent: () => <Cargando />,
  component: BandejaContabilidad,
});

function BandejaContabilidad() {
  const api = useApi();
  const { data } = useSuspenseQuery(bandejaContabilidadOptions(api));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Legalizaciones por revisar</h1>
        <div className="flex flex-wrap gap-4">
          <Link to="/contabilidad/conciliaciones" className="text-sm font-semibold text-marca-700 hover:underline">
            Conciliaciones bancarias →
          </Link>
          <Link to="/contabilidad/politica" className="text-sm font-semibold text-marca-700 hover:underline">
            Configuración (NIT, topes, exclusiones) →
          </Link>
        </div>
      </div>
      {data.length === 0 ? (
        <EstadoVacio titulo="No hay legalizaciones pendientes" />
      ) : (
        <ul className="space-y-3">
          {data.map((l) => {
            const alertas = l.soportes.filter((s) => s.requiereDecision && !s.decision).length;
            return (
              <li key={l.id}>
                <Link
                  to="/legalizaciones/$legalizacionId"
                  params={{ legalizacionId: l.id }}
                  className="block rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-marca-600"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-marca-800">{l.viajeroNombre}</p>
                      <p className="text-sm text-slate-600">
                        {l.soportes.length} soporte(s) · viaje {formatoFechaCalendario(l.viaje.inicio)} – {formatoFechaCalendario(l.viaje.fin)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-semibold">
                        {formatoDinero(l.resumen.totalAceptado)} de {formatoDinero(l.montoAnticipo)}
                      </span>
                      <div className="flex gap-1">
                        {alertas > 0 && <Insignia tono="aviso">{alertas} por decidir</Insignia>}
                        <InsigniaEstadoLegalizacion estado={l.estado} />
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
