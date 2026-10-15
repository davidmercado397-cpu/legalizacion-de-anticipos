import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { misSolicitudesOptions, useApi } from '@viaticos/client-app';
import { estadoSolicitudSchema } from '@viaticos/contracts';
import { z } from 'zod';
import { TarjetaSolicitud } from '../../../features/solicitudes/componentes';
import { t } from '../../../i18n';
import { cx } from '../../../lib/cx';
import { Cargando, EstadoVacio } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/solicitudes/')({
  // El filtro vive en la URL: se puede compartir y sobrevive a recargas.
  validateSearch: z.object({ estado: estadoSolicitudSchema.optional().catch(undefined) }),
  loader: ({ context }) => context.queryClient.ensureQueryData(misSolicitudesOptions(context.api)),
  pendingComponent: () => <Cargando />,
  component: MisSolicitudes,
});

const FILTROS = [undefined, ...estadoSolicitudSchema.options] as const;

function MisSolicitudes() {
  const api = useApi();
  const { estado } = Route.useSearch();
  const { data } = useSuspenseQuery(misSolicitudesOptions(api));
  const visibles = estado ? data.filter((s) => s.estado === estado) : data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Mis solicitudes</h1>
        <Link
          to="/solicitudes/nueva"
          className="inline-flex min-h-11 items-center rounded-lg bg-marca-700 px-4 text-sm font-semibold text-white hover:bg-marca-800"
        >
          + Nueva solicitud
        </Link>
      </div>
      <nav aria-label="Filtrar por estado" className="flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((f) => (
          <Link
            key={f ?? 'todas'}
            to="/solicitudes"
            search={{ estado: f }}
            className={cx(
              'whitespace-nowrap rounded-full px-3 py-1.5 text-sm ring-1',
              estado === f ? 'bg-marca-700 text-white ring-marca-700' : 'bg-white text-slate-700 ring-slate-300',
            )}
          >
            {f ? t(`estado.${f}`) : 'Todas'}
          </Link>
        ))}
      </nav>
      {visibles.length === 0 ? (
        <EstadoVacio titulo={estado ? 'No hay solicitudes en este estado' : 'Aún no tiene solicitudes'}>
          Proyecte su próximo viaje para conocer el presupuesto según su cargo.
        </EstadoVacio>
      ) : (
        <ul className="space-y-3">
          {visibles.map((s) => (
            <li key={s.id}>
              <TarjetaSolicitud solicitud={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
