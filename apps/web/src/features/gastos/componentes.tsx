import { Link } from '@tanstack/react-router';
import type { EstadoGasto, Gasto } from '@viaticos/contracts';
import { etiqueta } from '../../i18n';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { ReceiptText } from 'lucide-react';
import { botonClases } from '../../ui/boton';
import { EstadoVacio, Insignia } from '../../ui/superficies';
import { Tabla } from '../../ui/tabla';

const TONO: Record<EstadoGasto, 'neutro' | 'info' | 'exito' | 'aviso' | 'peligro'> = {
  received: 'neutro',
  processing: 'neutro',
  extracted: 'aviso',
  confirmed: 'exito',
  discarded: 'neutro',
  unreadable: 'peligro',
  failed: 'aviso',
};

export function InsigniaGasto({ estado }: { estado: EstadoGasto }) {
  return <Insignia tono={TONO[estado]}>{etiqueta('gasto', estado)}</Insignia>;
}

export interface Hallazgo {
  rule?: string;
  code?: string;
  action?: string;
  message?: string;
}

export const hallazgos = (gasto: Gasto): Hallazgo[] => gasto.policy_findings as Hallazgo[];

const ABIERTOS: EstadoGasto[] = ['received', 'processing', 'extracted', 'failed', 'unreadable'];

/** Qué falta para dar por buena una factura y el botón que lo resuelve; `null` si ya está. */
export function pendienteDe(g: Gasto): { texto: string; accion: string | null } | null {
  if (g.return_note && !g.return_resolved_at) return { texto: `Contabilidad pide: “${g.return_note}”`, accion: 'Corregir' };
  switch (g.status) {
    case 'received':
    case 'processing':
      return { texto: 'La IA la está leyendo', accion: null };
    case 'extracted':
      return { texto: 'Revisa que esté bien leída y confírmala', accion: 'Revisar y confirmar' };
    case 'failed':
      return { texto: 'No se leyó completa: llena los datos que faltan', accion: 'Completar' };
    case 'unreadable':
      return { texto: 'No se pudo leer: revísala o descártala', accion: 'Revisar' };
    default:
      return g.review_status === 'pending' ? { texto: 'Contabilidad la está revisando', accion: 'Ver' } : null;
  }
}

/** Primero lo que falta resolver, con su acción; después lo confirmado, en tabla. */
export function ListaGastos({ anticipoId, gastos, totalLegalizado }: { anticipoId: string; gastos: Gasto[]; totalLegalizado?: string }) {
  const visibles = gastos.filter((g) => g.status !== 'discarded');
  if (visibles.length === 0)
    return (
      <EstadoVacio titulo="Todavía no hay facturas" icono={ReceiptText}>
        Súbelas aquí o envía la foto por WhatsApp.
      </EstadoVacio>
    );
  const porResolver = visibles.filter((g) => pendienteDe(g) !== null);
  const listos = visibles.filter((g) => pendienteDe(g) === null);
  const enlace = (g: Gasto) => ({ to: '/anticipos/$anticipoId/gastos/$gastoId' as const, params: { anticipoId, gastoId: g.id } });

  return (
    <div className="space-y-8">
      {porResolver.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900">
            Por resolver <span className="ml-1 font-semibold text-slate-500">{porResolver.length}</span>
          </h3>
          <ul className="divide-y divide-slate-200 rounded-xl ring-1 ring-slate-200">
            {porResolver.map((g) => {
              const pendiente = pendienteDe(g)!;
              const devuelta = !!g.return_note && !g.return_resolved_at;
              return (
                <li key={g.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="size-11 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                    {g.file?.thumbnail_url && <img src={g.file.thumbnail_url} alt="" className="size-full object-cover" loading="lazy" />}
                  </div>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate font-semibold text-slate-900">
                      {g.vendor_name ?? (pendiente.accion ? 'Sin proveedor' : 'Leyendo…')}
                      {g.invoice_date && <span className="font-normal text-slate-500"> · {formatoFechaCalendario(g.invoice_date)}</span>}
                    </p>
                    <p className={devuelta ? 'text-sm text-red-700' : 'text-sm text-slate-600'}>{pendiente.texto}</p>
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="font-semibold tabular-nums">{formatoDinero(g.total, g.currency)}</span>
                    {pendiente.accion && (
                      <Link
                        {...enlace(g)}
                        className={botonClases({
                          variante: g.status === 'extracted' || devuelta ? 'primario' : 'secundario',
                          tamano: 'pequeno',
                        })}
                      >
                        {pendiente.accion}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {listos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900">
            Confirmadas <span className="ml-1 font-semibold text-slate-500">{listos.length}</span>
          </h3>
          <Tabla
            columnas={['Fecha', 'Proveedor', { titulo: 'Medio', secundaria: true }, { titulo: 'Valor', numerica: true }]}
            claves={listos.map((g) => g.id)}
            filas={listos.map((g) => {
              const alertas = hallazgos(g).filter((h) => h.action !== 'warn').length;
              return [
                <span className="whitespace-nowrap text-slate-500">{formatoFechaCalendario(g.invoice_date)}</span>,
                <span className="flex flex-wrap items-center gap-2">
                  <Link {...enlace(g)} className="font-semibold text-slate-900 hover:underline">
                    {g.vendor_name ?? 'Sin proveedor'}
                  </Link>
                  {alertas > 0 && <Insignia tono="aviso">{alertas === 1 ? '1 hallazgo' : `${alertas} hallazgos`}</Insignia>}
                </span>,
                <span className="text-slate-500">{g.payment_method ? etiqueta('medio', g.payment_method) : '—'}</span>,
                formatoDinero(g.total, g.currency),
              ];
            })}
            {...(totalLegalizado ? { pie: ['', 'Total legalizado', '', totalLegalizado] } : {})}
          />
        </div>
      )}
    </div>
  );
}
