import { useLineaDeTiempo } from '@viaticos/client-app';
import { formatoMomento } from '../../lib/formato';

/** Lo que ha pasado con el anticipo, lo más reciente al final. */
export function LineaDeTiempo({ anticipoId }: { anticipoId: string }) {
  const { data } = useLineaDeTiempo(anticipoId);
  if (!data?.length) return <p className="text-sm text-slate-500">Sin movimientos todavía.</p>;
  return (
    <ol className="space-y-3">
      {data.map((e, i) => (
        <li key={`${e.action}-${e.at}-${i}`} className="flex gap-3 text-sm">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">{e.label}</p>
            <p className="text-slate-500">
              {e.actor_name ?? 'Sistema'} · {formatoMomento(e.at)}
              {e.channel === 'whatsapp' && ' · por WhatsApp'}
            </p>
            {e.note && <p className="mt-1 text-slate-700">“{e.note}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
