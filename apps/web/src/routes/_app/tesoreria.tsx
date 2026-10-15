import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { anticiposPorEstadoOptions, useApi, useReintentarErp } from '@viaticos/client-app';
import { InsigniaEstadoAnticipo, resumenViaje } from '../../features/anticipos/componentes';
import { FormularioDesembolso } from '../../features/anticipos/formulario-desembolso';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Alerta, Cargando, EstadoVacio, Tarjeta } from '../../ui/superficies';

export const Route = createFileRoute('/_app/tesoreria')({
  beforeLoad: ({ context }) => {
    if (!context.sesion.getState().usuario?.roles.includes('TESORERIA')) throw redirect({ to: '/solicitudes' });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(anticiposPorEstadoOptions(context.api)),
  pendingComponent: () => <Cargando />,
  component: Tesoreria,
});

function Tesoreria() {
  const api = useApi();
  const { data } = useSuspenseQuery(anticiposPorEstadoOptions(api));
  const reintentar = useReintentarErp();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Anticipos por desembolsar</h1>
        <p className="text-sm text-slate-600">Solicitudes aprobadas cuyo anticipo ya está registrado en el ERP.</p>
      </div>
      {data.length === 0 ? (
        <EstadoVacio titulo="No hay anticipos pendientes" />
      ) : (
        <ul className="space-y-4">
          {data.map((a) => (
            <li key={a.id}>
              <Tarjeta className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-marca-800">{a.viajeroNombre}</p>
                    <p className="text-slate-900">{a.viaje.motivo}</p>
                    <p className="text-sm text-slate-600">{resumenViaje(a)}</p>
                    {a.erp.referencia && <p className="text-xs text-slate-500">ERP: {a.erp.referencia}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xl font-bold">{formatoDinero(a.monto)}</span>
                    <InsigniaEstadoAnticipo estado={a.estado} />
                  </div>
                </div>
                {a.estado === 'POR_DESEMBOLSAR' && <FormularioDesembolso anticipoId={a.id} />}
                {a.estado === 'PENDIENTE_ERP' && (
                  <Alerta tono="aviso" titulo="No se pudo registrar en el ERP">
                    <p>{a.erp.ultimoError ?? 'Registro pendiente.'} (intentos: {a.erp.intentos})</p>
                    <Boton
                      variante="secundario"
                      className="mt-2"
                      cargando={reintentar.isPending && reintentar.variables === a.id}
                      onClick={() => reintentar.mutate(a.id)}
                    >
                      Reintentar registro
                    </Boton>
                    {reintentar.isError && reintentar.variables === a.id && <p className="mt-1">{mensajeDeError(reintentar.error)}</p>}
                  </Alerta>
                )}
              </Tarjeta>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
