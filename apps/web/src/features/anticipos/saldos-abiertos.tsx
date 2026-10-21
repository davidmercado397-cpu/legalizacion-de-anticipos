import { Link } from '@tanstack/react-router';
import { useSaldosAbiertos } from '@viaticos/client-app';
import type { SaldoAbierto } from '@viaticos/contracts';
import { rangoFechas } from '../../lib/formato';
import { Seccion } from '../../ui/pagina';
import { Tarjeta } from '../../ui/superficies';
import { ResumenSaldo } from './componentes';

/** Los anticipos propios que tienen plata por legalizar; si no hay ninguno, no ocupa lugar. */
export function SaldosAbiertos() {
  const saldos = useSaldosAbiertos().data ?? [];
  if (saldos.length === 0) return null;
  return (
    <Seccion titulo="Por legalizar" contador={saldos.length}>
      <TarjetasSaldo saldos={saldos} />
    </Seccion>
  );
}

/** Un anticipo abierto por tarjeta: a dónde fue y cuánto le falta legalizar. */
export function TarjetasSaldo({ saldos }: { saldos: SaldoAbierto[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {saldos.map(({ advance, balance }) => (
        <Link key={advance.id} to="/anticipos/$anticipoId" params={{ anticipoId: advance.id }} className="rounded-xl">
          <Tarjeta className="space-y-3 transition-colors hover:ring-slate-400">
            <div>
              <p className="font-bold">{advance.destination ?? advance.purpose}</p>
              <p className="text-sm text-slate-500">{rangoFechas(advance.start_date, advance.end_date)}</p>
            </div>
            <ResumenSaldo saldo={balance} />
          </Tarjeta>
        </Link>
      ))}
    </div>
  );
}
