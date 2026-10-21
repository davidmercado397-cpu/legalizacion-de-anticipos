import { Link } from '@tanstack/react-router';
import type { EstadoGasto, Gasto } from '@viaticos/contracts';
import { etiqueta } from '../../i18n';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { EstadoVacio, Insignia } from '../../ui/superficies';

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

export function ListaGastos({ anticipoId, gastos }: { anticipoId: string; gastos: Gasto[] }) {
  const visibles = gastos.filter((g) => g.status !== 'discarded');
  if (visibles.length === 0) return <EstadoVacio titulo="Todavía no hay facturas">Súbalas aquí o envíe la foto por WhatsApp.</EstadoVacio>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {visibles.map((g) => {
        const alertas = hallazgos(g).filter((h) => h.action !== 'warn').length;
        return (
          <li key={g.id}>
            <Link
              to="/anticipos/$anticipoId/gastos/$gastoId"
              params={{ anticipoId, gastoId: g.id }}
              className="flex gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200 hover:ring-marca-600"
            >
              <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                {g.file?.thumbnail_url && <img src={g.file.thumbnail_url} alt="" className="size-full object-cover" loading="lazy" />}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate font-medium">{g.vendor_name ?? (g.status === 'processing' ? 'Leyendo…' : 'Sin proveedor')}</p>
                <p className="text-sm text-slate-500">
                  {formatoFechaCalendario(g.invoice_date)} · {formatoDinero(g.total, g.currency)}
                </p>
                <div className="flex flex-wrap gap-1">
                  <InsigniaGasto estado={g.status} />
                  {alertas > 0 && <Insignia tono="aviso">{alertas === 1 ? '1 hallazgo' : `${alertas} hallazgos`}</Insignia>}
                  {g.review_status === 'pending' && <Insignia tono="aviso">Por revisar</Insignia>}
                  {g.return_note && !g.return_resolved_at && <Insignia tono="peligro">Corregir</Insignia>}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
