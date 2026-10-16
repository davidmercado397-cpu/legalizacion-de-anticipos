import { Link } from '@tanstack/react-router';
import type { AnticipoResumen, EstadoAnticipo, Saldo } from '@viaticos/contracts';
import { etiqueta } from '../../i18n';
import { formatoDinero, rangoFechas } from '../../lib/formato';
import { EstadoVacio, Insignia } from '../../ui/superficies';

const TONO: Record<EstadoAnticipo, 'neutro' | 'info' | 'exito' | 'aviso' | 'peligro'> = {
  requested: 'aviso',
  approved: 'info',
  in_review: 'aviso',
  closed: 'exito',
  rejected: 'peligro',
  cancelled: 'neutro',
  voided: 'neutro',
};

export function InsigniaAnticipo({ estado }: { estado: EstadoAnticipo }) {
  return <Insignia tono={TONO[estado]}>{etiqueta('anticipo', estado)}</Insignia>;
}

/** Aprobado, gastado y por legalizar; si el anticipo está en otra moneda, también en la de la compañía. */
export function ResumenSaldo({ saldo }: { saldo: Saldo }) {
  const pendiente = Number(saldo.pending);
  return (
    <dl className="grid grid-cols-3 gap-3 text-sm">
      <div>
        <dt className="text-slate-500">Aprobado</dt>
        <dd className="font-semibold">{formatoDinero(saldo.amount, saldo.currency)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Legalizado</dt>
        <dd className="font-semibold">{formatoDinero(saldo.applied, saldo.currency)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">{pendiente < 0 ? 'Gastó de más' : 'Por legalizar'}</dt>
        <dd className={pendiente < 0 ? 'font-semibold text-red-700' : 'font-semibold'}>
          {formatoDinero(Math.abs(pendiente), saldo.currency)}
        </dd>
      </div>
      {saldo.functional && (
        <p className="col-span-3 text-xs text-slate-500">
          Por legalizar en {saldo.functional.currency}: {formatoDinero(saldo.functional.pending, saldo.functional.currency)} (tasa{' '}
          {Number(saldo.functional.rate).toLocaleString('es-CO')} del {saldo.functional.rate_date})
        </p>
      )}
    </dl>
  );
}

export function ListaAnticipos({
  anticipos,
  mostrarEmpleado = false,
  vacio,
}: {
  anticipos: AnticipoResumen[];
  mostrarEmpleado?: boolean;
  vacio: string;
}) {
  if (anticipos.length === 0) return <EstadoVacio titulo={vacio} />;
  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      {anticipos.map((a) => (
        <li key={a.id}>
          <Link
            to="/anticipos/$anticipoId"
            params={{ anticipoId: a.id }}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">
                {mostrarEmpleado && <span className="text-slate-500">{a.employee_name} · </span>}
                {a.destination ?? a.purpose}
              </p>
              <p className="text-sm text-slate-500">
                {rangoFechas(a.start_date, a.end_date) || a.purpose} · {etiqueta('tipo', a.kind)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold">{formatoDinero(a.amount, a.currency)}</span>
              <InsigniaAnticipo estado={a.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
