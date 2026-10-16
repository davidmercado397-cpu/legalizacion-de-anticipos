import { Link, createFileRoute } from '@tanstack/react-router';
import { useAnticipos, useSaldosAbiertos, useSesion } from '@viaticos/client-app';
import { mensajeDeError } from '../../../lib/errores';
import { rangoFechas } from '../../../lib/formato';
import { ListaAnticipos, ResumenSaldo } from '../../../features/anticipos/componentes';
import { Alerta, Cargando, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/anticipos/')({ component: MisAnticipos });

function MisAnticipos() {
  const usuarioId = useSesion((s) => s.usuario?.id);
  const saldos = useSaldosAbiertos();
  // La API filtra por visibilidad; en "Mis anticipos" solo van los propios.
  const anticipos = useAnticipos({ limit: 100 });
  const propios = (anticipos.data?.data ?? []).filter((a) => a.employee_id === usuarioId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Mis anticipos</h1>
        <Link to="/anticipos/nuevo" className="inline-flex min-h-11 items-center rounded-lg bg-marca-700 px-4 text-sm font-semibold text-white hover:bg-marca-800">
          Solicitar anticipo
        </Link>
      </div>

      {(saldos.data ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-slate-700">Por legalizar</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {saldos.data!.map(({ advance, balance }) => (
              <Link key={advance.id} to="/anticipos/$anticipoId" params={{ anticipoId: advance.id }}>
                <Tarjeta className="space-y-3 hover:ring-marca-600">
                  <div>
                    <p className="font-semibold">{advance.destination ?? advance.purpose}</p>
                    <p className="text-sm text-slate-500">{rangoFechas(advance.start_date, advance.end_date)}</p>
                  </div>
                  <ResumenSaldo saldo={balance} />
                </Tarjeta>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">Historial</h2>
        {anticipos.isPending ? (
          <Cargando />
        ) : anticipos.isError ? (
          <Alerta tono="peligro">{mensajeDeError(anticipos.error)}</Alerta>
        ) : (
          <ListaAnticipos anticipos={propios} vacio="Aún no ha solicitado anticipos" />
        )}
      </section>
    </div>
  );
}
