import type { AnticipoDetalle, GastoDetalle } from '@viaticos/contracts';
import { etiqueta } from '../../i18n';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { Alerta } from '../../ui/superficies';
import { hallazgos } from './componentes';

const TONO_ACCION: Record<string, 'peligro' | 'aviso' | 'info'> = { block: 'peligro', require_justification: 'aviso', review: 'aviso' };

/** Lo que hay que saber antes de tocar los datos: devolución, lectura, política y efectivo. */
export function AvisosGasto({ anticipo, gasto }: { anticipo: AnticipoDetalle; gasto: GastoDetalle }) {
  const lista = hallazgos(gasto);
  return (
    <div className="space-y-2 empty:hidden">
      {gasto.return_note && !gasto.return_resolved_at && (
        <Alerta tono="peligro" titulo="Te pidieron corregir">
          {gasto.return_note}
        </Alerta>
      )}
      {gasto.status === 'unreadable' && (
        <Alerta tono="peligro">No se pudo leer la foto. Tómala de nuevo con buena luz y súbela otra vez.</Alerta>
      )}
      {(gasto.status === 'received' || gasto.status === 'processing') && (
        <Alerta tono={gasto.last_error ? 'aviso' : 'info'}>
          {gasto.last_error
            ? 'La lectura automática falló y se intentará de nuevo. Si sigue fallando, en unos minutos podrás completar los datos a mano.'
            : 'Estamos leyendo la factura. En unos segundos aparecen los datos para que los revises.'}
        </Alerta>
      )}
      {lista.map((h, i) => (
        <Alerta key={`${h.rule}-${i}`} tono={TONO_ACCION[h.action ?? ''] ?? 'info'} titulo={etiqueta('regla', h.rule)}>
          {h.message ?? etiqueta('accion', h.action)}
        </Alerta>
      ))}
      <OrigenEfectivo anticipo={anticipo} gasto={gasto} />
    </div>
  );
}

/** Pagado en efectivo en otra moneda: de qué retiros salió y con qué tasa se legaliza (decisión 9.4). */
function OrigenEfectivo({ anticipo, gasto }: { anticipo: AnticipoDetalle; gasto: GastoDetalle }) {
  if (gasto.cash_allocations.length === 0 && !gasto.cash_uncovered) return null;
  const fecha = (id: string) => anticipo.withdrawals.find((r) => r.id === id)?.withdrawn_on;
  const tasa = (valor: string) => Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  return (
    <Alerta tono="info" titulo="Pagado en efectivo">
      <ul className="list-disc space-y-0.5 pl-5">
        {gasto.cash_allocations.map((d) => (
          <li key={d.withdrawal_id}>
            {formatoDinero(d.amount, gasto.currency)} del retiro del {formatoFechaCalendario(fecha(d.withdrawal_id))}, a {tasa(d.rate)}
          </li>
        ))}
        {gasto.cash_uncovered && (
          <li>{formatoDinero(gasto.cash_uncovered, gasto.currency)} sin un retiro que lo cubra: va con la tasa del día de la factura</li>
        )}
      </ul>
      {gasto.amount_applied && <p className="mt-1">Se legaliza por {formatoDinero(gasto.amount_applied, anticipo.balance.currency)}.</p>}
    </Alerta>
  );
}
