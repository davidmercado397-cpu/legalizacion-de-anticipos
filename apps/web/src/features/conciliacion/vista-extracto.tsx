import { Link } from '@tanstack/react-router';
import { useAccionCruce, useRecalcularExtracto } from '@viaticos/client-app';
import type { EstadoCruce, ExtractoResponse } from '@viaticos/contracts';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero, formatoFechaCalendario, formatoMomento } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Seleccion } from '../../ui/campos';
import { Alerta, EstadoVacio, Insignia, Tarjeta } from '../../ui/superficies';

type Movimiento = ExtractoResponse['movimientos'][number];

const ESTADOS: Record<EstadoCruce, { texto: string; tono: 'exito' | 'info' | 'aviso' }> = {
  AUTOMATICO: { texto: 'Conciliado', tono: 'exito' },
  CONFIRMADO: { texto: 'Confirmado', tono: 'exito' },
  MANUAL: { texto: 'Enlazado a mano', tono: 'info' },
  SUGERIDO: { texto: 'Por revisar', tono: 'aviso' },
};

function diferencia(m: Movimiento): string | null {
  const esperado = Number(m.cruce?.montoSoporte?.monto);
  if (!esperado) return null;
  const pct = ((Number(m.valor.monto) - esperado) / esperado) * 100;
  return Math.abs(pct) < 0.05 ? 'mismo valor' : `${pct > 0 ? '+' : ''}${pct.toLocaleString('es-CO', { maximumFractionDigits: 1 })} % vs. factura`;
}

export function VistaExtracto({ extracto: e, puedeDecidir }: { extracto: ExtractoResponse; puedeDecidir: boolean }) {
  const accion = useAccionCruce();
  const recalcular = useRecalcularExtracto();
  const cargos = e.movimientos.filter((m) => m.tipo === 'DEBITO');
  const abonos = e.movimientos.filter((m) => m.tipo === 'CREDITO');
  const fallo = accion.error ?? recalcular.error;
  const ocupado = (movimientoId: string) => accion.isPending && accion.variables?.movimientoId === movimientoId;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Conciliación del extracto</h1>
          <p className="text-sm text-slate-600">
            {e.titularNombre ?? 'Viajero'}
            {e.ultimos4 && ` · tarjeta ****${e.ultimos4}`} · {formatoFechaCalendario(e.periodo.desde)} – {formatoFechaCalendario(e.periodo.hasta)}
          </p>
          <p className="text-xs text-slate-500">
            {e.archivoNombre} · cargado {formatoMomento(e.cargadoEn)}
          </p>
        </div>
        {puedeDecidir && (
          <Boton variante="secundario" cargando={recalcular.isPending} onClick={() => recalcular.mutate(e.id)}>
            Volver a cruzar
          </Boton>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Indicador titulo="Cargos" valor={String(e.resumen.cargos)} detalle={formatoDinero(e.resumen.totalCargos)} />
        <Indicador titulo="Conciliados" valor={String(e.resumen.conciliados)} tono="exito" />
        <Indicador titulo="Por revisar" valor={String(e.resumen.porRevisar)} tono={e.resumen.porRevisar ? 'aviso' : 'neutro'} />
        <Indicador
          titulo="Cargos sin factura"
          valor={String(e.resumen.cargosSinSoporte)}
          detalle={formatoDinero(e.resumen.totalCargosSinSoporte)}
          tono={e.resumen.cargosSinSoporte ? 'peligro' : 'neutro'}
        />
      </dl>

      {fallo && <Alerta tono="peligro">{mensajeDeError(fallo)}</Alerta>}

      <section className="space-y-3" aria-label="Cargos del extracto">
        <h2 className="text-lg font-semibold">Cargos de la tarjeta ({cargos.length})</h2>
        {cargos.map((m) => (
          <Tarjeta key={m.id} className="space-y-2 !p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium break-words">{m.descripcion}</p>
                <p className="text-xs text-slate-500">
                  {formatoFechaCalendario(m.fecha)} · fila {m.fila}
                  {m.referencia && ` · ref. ${m.referencia}`}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="font-semibold whitespace-nowrap">{formatoDinero(m.valor)}</span>
                {m.cruce ? <Insignia tono={ESTADOS[m.cruce.estado].tono}>{ESTADOS[m.cruce.estado].texto}</Insignia> : <Insignia tono="peligro">Sin factura</Insignia>}
              </div>
            </div>

            {m.cruce?.pago && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p>
                  Factura de <span className="font-semibold">{m.cruce.pago.emisor}</span> del {formatoFechaCalendario(m.cruce.pago.fecha)} por{' '}
                  {formatoDinero(m.cruce.pago.totalOriginal)}
                  {m.cruce.pago.totalOriginal.moneda !== m.valor.moneda && m.cruce.montoSoporte && <> (≈ {formatoDinero(m.cruce.montoSoporte)})</>}
                </p>
                <p className="text-xs text-slate-500">
                  {diferencia(m)}
                  {m.cruce.puntaje !== null && ` · coincidencia ${Math.round(m.cruce.puntaje * 100)} %`}
                  {' · '}
                  <Link to="/legalizaciones/$legalizacionId" params={{ legalizacionId: m.cruce.pago.legalizacionId }} className="text-marca-700 hover:underline">
                    ver legalización
                  </Link>
                </p>
              </div>
            )}

            {puedeDecidir && (
              <div className="flex flex-wrap justify-end gap-2">
                {m.cruce && (m.cruce.estado === 'AUTOMATICO' || m.cruce.estado === 'SUGERIDO') && (
                  <Boton cargando={ocupado(m.id) && accion.variables?.accion === 'confirmar'} onClick={() => accion.mutate({ id: e.id, movimientoId: m.id, accion: 'confirmar' })}>
                    Confirmar
                  </Boton>
                )}
                {m.cruce && (
                  <Boton
                    variante="fantasma"
                    className="text-red-700"
                    cargando={ocupado(m.id) && accion.variables?.accion === 'rechazar'}
                    onClick={() => accion.mutate({ id: e.id, movimientoId: m.id, accion: 'rechazar' })}
                  >
                    No corresponde
                  </Boton>
                )}
                {!m.cruce && e.pagosSinMovimiento.length > 0 && (
                  <Enlazar
                    pagos={e.pagosSinMovimiento}
                    cargando={ocupado(m.id)}
                    alEnlazar={(soporteId) => accion.mutate({ id: e.id, movimientoId: m.id, accion: 'enlazar', soporteId })}
                  />
                )}
              </div>
            )}
          </Tarjeta>
        ))}
      </section>

      <section className="space-y-3" aria-label="Facturas sin cargo">
        <h2 className="text-lg font-semibold">Facturas con tarjeta que no aparecen en el extracto ({e.pagosSinMovimiento.length})</h2>
        {e.pagosSinMovimiento.length === 0 ? (
          <EstadoVacio titulo="Todas las facturas con tarjeta del periodo tienen su cargo" />
        ) : (
          <Tarjeta className="!p-0">
            <ul className="divide-y divide-slate-100">
              {e.pagosSinMovimiento.map((p) => (
                <li key={p.soporteId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>
                    <span className="font-medium">{p.emisor}</span> · {formatoFechaCalendario(p.fecha)}
                  </span>
                  <span className="font-semibold">
                    {formatoDinero(p.totalOriginal)}
                    {p.totalEnMonedaExtracto && p.totalOriginal.moneda !== p.totalEnMonedaExtracto.moneda && (
                      <span className="ml-1 font-normal text-slate-500">(≈ {formatoDinero(p.totalEnMonedaExtracto)})</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
      </section>

      {abonos.length > 0 && (
        <details className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <summary className="cursor-pointer font-semibold">Abonos ({abonos.length}) — no se cruzan con facturas</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {abonos.map((m) => (
              <li key={m.id} className="flex justify-between gap-2 py-1.5">
                <span>
                  {formatoFechaCalendario(m.fecha)} · {m.descripcion}
                </span>
                <span className="text-emerald-700">+ {formatoDinero(m.valor)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Enlazar({ pagos, cargando, alEnlazar }: { pagos: ExtractoResponse['pagosSinMovimiento']; cargando: boolean; alEnlazar: (soporteId: string) => void }) {
  const [elegido, setElegido] = useState('');
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
      <Seleccion aria-label="Factura para enlazar" className="min-w-0 flex-1 sm:w-72" value={elegido} onChange={(e) => setElegido(e.target.value)}>
        <option value="">Enlazar con una factura…</option>
        {pagos.map((p) => (
          <option key={p.soporteId} value={p.soporteId}>
            {p.emisor} · {formatoFechaCalendario(p.fecha)} · {formatoDinero(p.totalOriginal)}
          </option>
        ))}
      </Seleccion>
      <Boton variante="secundario" disabled={!elegido} cargando={cargando} onClick={() => alEnlazar(elegido)}>
        Enlazar
      </Boton>
    </div>
  );
}

function Indicador({ titulo, valor, detalle, tono = 'neutro' }: { titulo: string; valor: string; detalle?: string; tono?: 'neutro' | 'exito' | 'aviso' | 'peligro' }) {
  const color = { neutro: 'text-slate-900', exito: 'text-emerald-700', aviso: 'text-amber-700', peligro: 'text-red-700' }[tono];
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <dt className="text-xs font-medium text-slate-500 uppercase">{titulo}</dt>
      <dd className={`text-2xl font-bold ${color}`}>{valor}</dd>
      {detalle && <dd className="text-xs text-slate-600">{detalle}</dd>}
    </div>
  );
}
