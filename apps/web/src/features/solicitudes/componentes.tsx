import { Link } from '@tanstack/react-router';
import type { EstimadoResponse, SolicitudResponse, TasasDelDiaResponse } from '@viaticos/contracts';
import { useState } from 'react';
import { t } from '../../i18n';
import { cx } from '../../lib/cx';
import { formatoDinero, formatoFechaCalendario, formatoMomento, nombrePais } from '../../lib/formato';
import { Alerta, Insignia } from '../../ui/superficies';

type Presupuesto = EstimadoResponse['presupuesto'];
type Escalamiento = EstimadoResponse['escalamiento'];
type Destino = { paisCodigo: string; ciudad: string; fechaInicio: string; fechaFin: string };

const TONO_ESTADO = { EN_APROBACION: 'aviso', APROBADA: 'exito', RECHAZADA: 'peligro', CANCELADA: 'neutro' } as const;

export function InsigniaEstado({ estado }: { estado: SolicitudResponse['estado'] }) {
  return <Insignia tono={TONO_ESTADO[estado]}>{t(`estado.${estado}`)}</Insignia>;
}

export const rangoFechas = (destinos: readonly Destino[]) =>
  destinos.length
    ? `${formatoFechaCalendario(destinos[0]!.fechaInicio)} – ${formatoFechaCalendario(destinos.at(-1)!.fechaFin)}`
    : '';

const DECIMAL = /^\d{1,13}(\.\d{1,2})?$/;

/** Valor por día/noche editable; confirma al salir del campo para no recalcular en cada tecla. */
function ValorPropuesto({
  valor,
  etiqueta,
  alConfirmar,
}: {
  valor: string;
  etiqueta: string;
  alConfirmar: (valor: string) => void;
}) {
  const [invalido, setInvalido] = useState(false);
  return (
    <div>
      <input
        key={valor}
        defaultValue={valor}
        inputMode="decimal"
        aria-label={etiqueta}
        aria-invalid={invalido || undefined}
        className={cx(
          'min-h-11 w-full rounded-lg border bg-white px-2 text-right text-base sm:min-h-9 sm:text-sm',
          invalido ? 'border-red-600' : 'border-slate-300',
        )}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={(e) => {
          const nuevo = e.currentTarget.value.trim().replace(',', '.');
          const ok = DECIMAL.test(nuevo);
          setInvalido(!ok);
          if (ok && nuevo !== valor) alConfirmar(nuevo);
        }}
      />
      {invalido && <p className="mt-1 text-xs text-red-700">{t('validation.decimal')}</p>}
    </div>
  );
}

/** Presupuesto por destino y concepto. Con `alProponer`, el valor unitario es editable. */
export function TablaPresupuesto({
  presupuesto,
  destinos,
  alProponer,
}: {
  presupuesto: Presupuesto;
  destinos: readonly Destino[];
  alProponer?: (destinoIndice: number, conceptoCodigo: string, valor: string | null) => void;
}) {
  const porDestino = destinos.map((d, i) => ({ d, lineas: presupuesto.lineas.filter((l) => l.destinoIndice === i) }));
  return (
    <div className="space-y-5">
      {porDestino.map(({ d, lineas }, i) => (
        <section key={i} aria-label={`Destino ${d.ciudad}`}>
          <h3 className="text-sm font-semibold text-slate-800">
            {d.ciudad}, {nombrePais(d.paisCodigo)}
            <span className="ml-2 font-normal text-slate-500">
              {formatoFechaCalendario(d.fechaInicio)} – {formatoFechaCalendario(d.fechaFin)}
            </span>
          </h3>
          <div className="mt-2 hidden grid-cols-[1.4fr_0.8fr_1fr_1.1fr_1fr] gap-4 border-b border-slate-200 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500 sm:grid">
            <span>Concepto</span>
            <span>Cantidad</span>
            <span className="text-right">Tarifa</span>
            <span className="text-right">Valor por unidad</span>
            <span className="text-right">Subtotal</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {lineas.map((l) => (
              <li
                key={l.conceptoCodigo}
                className="grid grid-cols-2 items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[1.4fr_0.8fr_1fr_1.1fr_1fr]"
              >
                <span className="col-span-2 flex flex-wrap items-center gap-2 font-medium sm:col-span-1">
                  {l.conceptoNombre}
                  {l.excedeTarifa && <Insignia tono="aviso">Supera la tarifa</Insignia>}
                </span>
                <span className="text-sm text-slate-600">
                  {l.cantidad} {t(`unidad.${l.unidad}`)}
                </span>
                <span className="text-right text-sm text-slate-600">
                  <span className="sm:hidden">Tarifa: </span>
                  {formatoDinero(l.tarifaUnitaria)}
                </span>
                <span className="col-span-2 sm:col-span-1 sm:text-right">
                  {alProponer ? (
                    <ValorPropuesto
                      valor={l.valorUnitarioSolicitado.monto}
                      etiqueta={`Valor por ${l.unidad === 'NOCHE' ? 'noche' : 'día'} de ${l.conceptoNombre} en ${d.ciudad} (${l.valorUnitarioSolicitado.moneda})`}
                      alConfirmar={(v) =>
                        alProponer(i, l.conceptoCodigo, Number(v) === Number(l.tarifaUnitaria.monto) ? null : v)
                      }
                    />
                  ) : (
                    <span className={cx('text-sm', l.excedeTarifa && 'font-semibold text-amber-800')}>
                      {formatoDinero(l.valorUnitarioSolicitado)}
                    </span>
                  )}
                </span>
                <span className="col-span-2 text-right font-semibold sm:col-span-1">{formatoDinero(l.subtotal)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-200 pt-3">
        <span className="text-sm text-slate-600">
          Total del anticipo
          {presupuesto.tasasAplicadas.map((tasa) => (
            <span key={tasa.origen} className="ml-2 text-xs text-slate-500">
              ({tasa.origen}→{tasa.destino}: {Number(tasa.valor).toLocaleString('es-CO', { maximumFractionDigits: 6 })} · {tasa.fuente})
            </span>
          ))}
        </span>
        <span className="text-xl font-bold text-slate-900">{formatoDinero(presupuesto.totalAnticipo)}</span>
      </div>
    </div>
  );
}

export function AvisoEscalamiento({ escalamiento }: { escalamiento: Escalamiento }) {
  if (!escalamiento.requiereJefeDirectivo) return null;
  return (
    <Alerta tono="aviso" titulo="Requiere aprobación del jefe directivo">
      <ul className="list-disc space-y-1 pl-5">
        {escalamiento.motivos.map((m, i) => (
          <li key={i}>{m.descripcion}</li>
        ))}
      </ul>
    </Alerta>
  );
}

export function LineaTiempoAprobacion({ ruta }: { ruta: SolicitudResponse['ruta'] }) {
  return (
    <ol className="space-y-4">
      {ruta.map((p) => (
        <li key={p.orden} className="flex gap-3">
          <span
            aria-hidden
            className={cx(
              'mt-1 size-3 shrink-0 rounded-full ring-4',
              p.estado === 'APROBADO' && 'bg-emerald-600 ring-emerald-100',
              p.estado === 'RECHAZADO' && 'bg-red-600 ring-red-100',
              p.estado === 'PENDIENTE' && 'bg-slate-300 ring-slate-100',
            )}
          />
          <div className="text-sm">
            <p className="font-medium text-slate-900">
              {p.aprobadorNombre} <span className="font-normal text-slate-500">· {t(`nivel.${p.nivel}`)}</span>
            </p>
            <p className="text-slate-600">
              {t(`paso.${p.estado}`)}
              {p.decididoEn && ` · ${formatoMomento(p.decididoEn)}`}
            </p>
            {p.comentario && <p className="mt-1 rounded-md bg-slate-50 p-2 text-slate-700">“{p.comentario}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function TarjetaSolicitud({ solicitud, mostrarViajero = false }: { solicitud: SolicitudResponse; mostrarViajero?: boolean }) {
  return (
    <Link
      to="/solicitudes/$solicitudId"
      params={{ solicitudId: solicitud.id }}
      className="block rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-marca-600"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {mostrarViajero && <p className="text-sm font-semibold text-marca-800">{solicitud.viajeroNombre}</p>}
          <p className="truncate font-medium text-slate-900">{solicitud.motivo}</p>
          <p className="text-sm text-slate-600">
            {solicitud.destinos.map((d) => d.ciudad).join(' → ')} · {rangoFechas(solicitud.destinos)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-semibold">{formatoDinero(solicitud.presupuesto.totalAnticipo)}</span>
          <div className="flex gap-1">
            {solicitud.escalamiento.requiereJefeDirectivo && <Insignia tono="info">Directivo</Insignia>}
            <InsigniaEstado estado={solicitud.estado} />
          </div>
        </div>
      </div>
    </Link>
  );
}

/** TRM y demás tasas por dólar vigentes hoy, con su fuente oficial. */
export function TasasDelDia({ tasas }: { tasas: TasasDelDiaResponse | undefined }) {
  if (!tasas) return null;
  const disponibles = tasas.cotizaciones.filter((c) => c.porDolar !== null);
  if (disponibles.length === 0) {
    return <p className="text-xs text-amber-800">Las tasas oficiales de hoy no están disponibles; se intentará de nuevo.</p>;
  }
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Tasas de cambio de hoy">
      {disponibles.map((c) => (
        <span key={c.moneda}>
          <span className="font-semibold text-slate-800">
            1 USD = {Number(c.porDolar).toLocaleString('es-CO', { maximumFractionDigits: 4 })} {c.moneda}
          </span>{' '}
          ({c.fuente})
        </span>
      ))}
    </p>
  );
}
