import { Link } from '@tanstack/react-router';
import type { ExtractoResumenResponse } from '@viaticos/contracts';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { Insignia } from '../../ui/superficies';

export function ListaExtractos({ extractos, conTitular = false }: { extractos: ExtractoResumenResponse[]; conTitular?: boolean }) {
  return (
    <ul className="space-y-2">
      {extractos.map((e) => (
        <li key={e.id}>
          <Link
            to="/conciliacion/$extractoId"
            params={{ extractoId: e.id }}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 hover:ring-marca-600"
          >
            <div className="min-w-0">
              <p className="font-medium text-marca-800">
                {conTitular && `${e.titularNombre ?? 'Viajero'} · `}
                {e.ultimos4 ? `Tarjeta ****${e.ultimos4}` : 'Extracto'} · {formatoFechaCalendario(e.periodo.desde)} – {formatoFechaCalendario(e.periodo.hasta)}
              </p>
              <p className="truncate text-xs text-slate-500">{e.archivoNombre}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Insignia tono="exito">{e.resumen.conciliados} conciliados</Insignia>
              {e.resumen.porRevisar > 0 && <Insignia tono="aviso">{e.resumen.porRevisar} por revisar</Insignia>}
              {e.resumen.cargosSinSoporte > 0 && (
                <Insignia tono="peligro">
                  {e.resumen.cargosSinSoporte} sin factura ({formatoDinero(e.resumen.totalCargosSinSoporte)})
                </Insignia>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
