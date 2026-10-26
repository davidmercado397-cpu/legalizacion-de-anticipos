import type { AnticipoDetalle } from '@viaticos/contracts';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { Cifra, Cifras } from '../../ui/cifras';
import { describirEntrega } from './componentes';

const DIA = 86_400_000;

/** Días de hoy a una fecha de negocio (negativo si ya pasó). */
function diasHasta(iso: string): number {
  const hoy = new Date();
  const inicio = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - inicio) / DIA);
}

/** Aprobado, legalizado, lo que falta y el plazo, cada cifra con el dato que la explica. */
export function FranjaSaldo({ anticipo }: { anticipo: AnticipoDetalle }) {
  const { balance: saldo } = anticipo;
  const pendiente = Number(saldo.pending);
  const avance = Number(saldo.amount) > 0 ? Math.min(100, (Number(saldo.applied) / Number(saldo.amount)) * 100) : 0;
  const plazo = anticipo.status === 'approved' && anticipo.legalization_due ? diasHasta(anticipo.legalization_due) : null;

  return (
    <Cifras columnas={plazo === null ? 3 : 4}>
      <Cifra titulo="Aprobado" valor={formatoDinero(saldo.amount, saldo.currency)}>
        {anticipo.disbursed_at
          ? `Entregado: ${describirEntrega(anticipo)}`
          : anticipo.status === 'approved'
            ? 'Tesorería aún no lo entrega'
            : null}
      </Cifra>
      <Cifra titulo="Legalizado" valor={formatoDinero(saldo.applied, saldo.currency)}>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <span className="block h-full rounded-full bg-marca-600" style={{ width: `${avance}%` }} />
        </span>
        <span className="mt-1 block">{saldo.expenses_count === 1 ? '1 factura' : `${saldo.expenses_count} facturas`}</span>
      </Cifra>
      <Cifra
        titulo={pendiente < 0 ? 'Gastaste de más' : 'Por legalizar'}
        valor={formatoDinero(Math.abs(pendiente), saldo.currency)}
        peligro={pendiente < 0}
      >
        {saldo.functional &&
          `${formatoDinero(saldo.functional.pending, saldo.functional.currency)} con la tasa ${Number(saldo.functional.rate).toLocaleString('es-CO')} del ${formatoFechaCalendario(saldo.functional.rate_date)}`}
      </Cifra>
      {plazo !== null && (
        <Cifra titulo="Plazo para legalizar" valor={formatoFechaCalendario(anticipo.legalization_due)} peligro={plazo < 0}>
          {plazo < 0
            ? `Venció hace ${-plazo} ${plazo === -1 ? 'día' : 'días'}`
            : plazo === 0
              ? 'Vence hoy'
              : `Quedan ${plazo} ${plazo === 1 ? 'día' : 'días'}`}
        </Cifra>
      )}
    </Cifras>
  );
}
