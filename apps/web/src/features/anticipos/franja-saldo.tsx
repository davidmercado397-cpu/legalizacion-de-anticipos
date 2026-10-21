import type { AnticipoDetalle } from '@viaticos/contracts';
import type { ReactNode } from 'react';
import { etiqueta } from '../../i18n';
import { cx } from '../../lib/cx';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';

const DIA = 86_400_000;

/** Días de hoy a una fecha de negocio (negativo si ya pasó). */
function diasHasta(iso: string): number {
  const hoy = new Date();
  const inicio = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - inicio) / DIA);
}

function Cifra({ titulo, valor, peligro, children }: { titulo: string; valor: string; peligro?: boolean; children?: ReactNode }) {
  return (
    <div className="space-y-1 bg-white p-4">
      <dt className="text-sm text-slate-600">{titulo}</dt>
      <dd className={cx('text-xl font-bold tracking-tight tabular-nums', peligro ? 'text-red-700' : 'text-slate-900')}>{valor}</dd>
      {children && <dd className="text-xs text-slate-500">{children}</dd>}
    </div>
  );
}

/** Aprobado, legalizado, lo que falta y el plazo, cada cifra con el dato que la explica. */
export function FranjaSaldo({ anticipo }: { anticipo: AnticipoDetalle }) {
  const { balance: saldo } = anticipo;
  const pendiente = Number(saldo.pending);
  const avance = Number(saldo.amount) > 0 ? Math.min(100, (Number(saldo.applied) / Number(saldo.amount)) * 100) : 0;
  const plazo = anticipo.status === 'approved' && anticipo.legalization_due ? diasHasta(anticipo.legalization_due) : null;

  return (
    <dl
      className={cx(
        'grid gap-px overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-200',
        plazo === null ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4',
      )}
    >
      <Cifra titulo="Aprobado" valor={formatoDinero(saldo.amount, saldo.currency)}>
        {anticipo.disbursed_at
          ? `Entregado por ${etiqueta('desembolso', anticipo.disbursement_method).toLowerCase()}`
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
    </dl>
  );
}
