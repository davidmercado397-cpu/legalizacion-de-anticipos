import { useLineaDeTiempo } from '@viaticos/client-app';
import { formatoMomento } from '../../lib/formato';

export function LineaDeTiempo({ anticipoId }: { anticipoId: string }) {
  const { data } = useLineaDeTiempo(anticipoId);
  if (!data?.length) return null;
  return (
    <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
      {data.map((e, i) => (
        <li key={`${e.action}-${e.at}-${i}`} className="text-sm">
          <p className="font-medium text-slate-800">{e.label}</p>
          <p className="text-slate-500">
            {e.actor_name ?? 'Sistema'} · {formatoMomento(e.at)}
            {e.channel === 'whatsapp' && ' · por WhatsApp'}
          </p>
          {e.note && <p className="mt-1 text-slate-600">“{e.note}”</p>}
        </li>
      ))}
    </ol>
  );
}
