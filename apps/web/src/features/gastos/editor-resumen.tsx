import type { GastoDetalle } from '@viaticos/contracts';
import type { ReactNode } from 'react';
import { etiqueta } from '../../i18n';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';

type Fila = [string, ReactNode, 'monto'?];

function Bloque({ titulo, filas }: { titulo: string; filas: Fila[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-slate-900">{titulo}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {filas.map(([nombre, valor, tipo]) => (
          <div key={nombre} className="contents">
            <dt className="text-slate-600">{nombre}</dt>
            <dd className={tipo === 'monto' ? 'font-semibold tabular-nums' : 'font-semibold'}>{valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Los datos de una factura que ya no se edita, en los mismos grupos del formulario. */
export function ResumenGasto({ gasto }: { gasto: GastoDetalle }) {
  const dinero = (v: string | null) => formatoDinero(v, gasto.currency);
  const documento: Fila[] = [
    ['Tipo de documento', etiqueta('documento', gasto.document_type)],
    ['Proveedor', gasto.vendor_name ?? '—'],
    ['NIT', gasto.vendor_tax_id ?? '—'],
    ['Número', gasto.invoice_number ?? '—'],
    ['Fecha', formatoFechaCalendario(gasto.invoice_date)],
  ];
  if (gasto.document_type === 'cash_receipt') documento.push(['Firmado por quien vende', gasto.receipt_signed ? 'Sí' : 'No']);
  const valores: Fila[] = [
    ['Total', dinero(gasto.total), 'monto'],
    ['Subtotal', dinero(gasto.subtotal), 'monto'],
    ['Impuestos', dinero(gasto.tax_amount), 'monto'],
    ['Propina', dinero(gasto.tip_amount), 'monto'],
    ['Descuento', dinero(gasto.discount_amount), 'monto'],
  ];
  if (gasto.bank_status === 'matched' && gasto.bank_amount)
    valores.push(['Cobrado por el banco', formatoDinero(gasto.bank_amount, gasto.bank_currency), 'monto']);
  if (gasto.non_reimbursable_amount) valores.push(['No reembolsable', formatoDinero(gasto.non_reimbursable_amount, null), 'monto']);
  const pago: Fila[] = [
    ['Medio de pago', etiqueta('medio', gasto.payment_method)],
    ['Justificación', gasto.justification ?? '—'],
  ];
  return (
    <div className="space-y-8">
      <Bloque titulo="Documento" filas={documento} />
      <Bloque titulo="Valores" filas={valores} />
      <Bloque titulo="Pago y soporte" filas={pago} />
    </div>
  );
}
