import { Link, createFileRoute } from '@tanstack/react-router';
import { useAnticipos, useSaldosAbiertos, useSesion } from '@viaticos/client-app';
import { Plus } from 'lucide-react';
import { rangoFechas } from '../../../lib/formato';
import { ListaAnticipos, ResumenSaldo } from '../../../features/anticipos/componentes';
import { botonClases } from '../../../ui/boton';
import { EstadoConsulta } from '../../../ui/estado-consulta';
import { EncabezadoPagina, Seccion } from '../../../ui/pagina';
import { Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/anticipos/')({ component: MisAnticipos });

function MisAnticipos() {
  const usuarioId = useSesion((s) => s.usuario?.id);
  const saldos = useSaldosAbiertos();
  // La API filtra por visibilidad; en "Mis anticipos" solo van los propios.
  const anticipos = useAnticipos({ limit: 100 });

  return (
    <div className="space-y-10">
      <EncabezadoPagina
        titulo="Mis anticipos"
        acciones={
          <Link to="/anticipos/nuevo" className={botonClases()}>
            <Plus aria-hidden />
            Solicitar anticipo
          </Link>
        }
      />

      {(saldos.data ?? []).length > 0 && (
        <Seccion titulo="Por legalizar" contador={saldos.data!.length}>
          <div className="grid gap-3 sm:grid-cols-2">
            {saldos.data!.map(({ advance, balance }) => (
              <Link key={advance.id} to="/anticipos/$anticipoId" params={{ anticipoId: advance.id }}>
                <Tarjeta className="space-y-3 transition-shadow hover:ring-slate-400">
                  <div>
                    <p className="font-bold">{advance.destination ?? advance.purpose}</p>
                    <p className="text-sm text-slate-500">{rangoFechas(advance.start_date, advance.end_date)}</p>
                  </div>
                  <ResumenSaldo saldo={balance} />
                </Tarjeta>
              </Link>
            ))}
          </div>
        </Seccion>
      )}

      <Seccion titulo="Historial">
        <EstadoConsulta consulta={anticipos}>
          {(pagina) => (
            <ListaAnticipos anticipos={pagina.data.filter((a) => a.employee_id === usuarioId)} vacio="Todavía no has solicitado anticipos" />
          )}
        </EstadoConsulta>
      </Seccion>
    </div>
  );
}
