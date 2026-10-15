import { Link } from '@tanstack/react-router';
import type { AnticipoResponse } from '@viaticos/contracts';
import { t } from '../../i18n';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { Insignia } from '../../ui/superficies';

const TONO = { PENDIENTE_ERP: 'aviso', POR_DESEMBOLSAR: 'info', DESEMBOLSADO: 'aviso', LEGALIZADO: 'exito' } as const;

export function InsigniaEstadoAnticipo({ estado }: { estado: AnticipoResponse['estado'] }) {
  return <Insignia tono={TONO[estado]}>{t(`estadoAnticipo.${estado}`)}</Insignia>;
}

export const resumenViaje = (a: AnticipoResponse) =>
  `${a.viaje.destinos.map((d) => d.ciudad).join(' → ')} · ${formatoFechaCalendario(a.viaje.fechaInicio)} – ${formatoFechaCalendario(a.viaje.fechaFin)}`;

export function TarjetaAnticipo({ anticipo, mostrarViajero = false }: { anticipo: AnticipoResponse; mostrarViajero?: boolean }) {
  return (
    <Link
      to="/anticipos/$anticipoId"
      params={{ anticipoId: anticipo.id }}
      className="block rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-marca-600"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {mostrarViajero && <p className="text-sm font-semibold text-marca-800">{anticipo.viajeroNombre}</p>}
          <p className="truncate font-medium text-slate-900">{anticipo.viaje.motivo}</p>
          <p className="text-sm text-slate-600">{resumenViaje(anticipo)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-semibold">{formatoDinero(anticipo.monto)}</span>
          <InsigniaEstadoAnticipo estado={anticipo.estado} />
        </div>
      </div>
    </Link>
  );
}
