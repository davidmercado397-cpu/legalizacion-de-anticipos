import { useAccionMovimiento } from '@viaticos/client-app';
import type { AnticipoDetalle, Extracto, MovimientoExtracto } from '@viaticos/contracts';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero, formatoFechaCalendario, formatoMomento } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Seleccion } from '../../ui/campos';
import { Alerta, Insignia, Tarjeta } from '../../ui/superficies';

type Gasto = AnticipoDetalle['expenses'][number];

// --- Revisión de los cruces -----------------------------------------------------------------------

const ESTADOS = {
  auto: { texto: 'Cruzado automáticamente', tono: 'exito' },
  suggested: { texto: 'Por revisar', tono: 'aviso' },
  confirmed: { texto: 'Confirmado', tono: 'exito' },
  manual: { texto: 'Cruzado a mano', tono: 'info' },
} as const;

function estado(m: MovimientoExtracto) {
  if (m.match_status) return ESTADOS[m.match_status];
  if (m.charge_decision === 'absorb') return { texto: 'Lo asume la empresa', tono: 'info' } as const;
  if (m.charge_decision === 'discount') return { texto: 'Se descuenta al viajero', tono: 'aviso' } as const;
  return { texto: 'Sin factura', tono: 'peligro' } as const;
}

export function VistaExtracto({ extracto: e, anticipo, decide }: { extracto: Extracto; anticipo: AnticipoDetalle; decide: boolean }) {
  const accion = useAccionMovimiento(anticipo.id);
  const cargos = e.movements.filter((m) => m.is_charge && m.in_trip);
  const fuera = e.movements.filter((m) => m.is_charge && !m.in_trip);
  const pendientes = cargos.filter((m) => m.needs_decision).length;
  const cruzados = new Set(e.movements.map((m) => m.expense_id).filter(Boolean));
  // Los cargos que asume la empresa ya son gastos (origen «bank»): no se ofrecen para cruzar.
  const libres = anticipo.expenses.filter(
    (g) => g.status === 'confirmed' && g.payment_method === 'card' && g.source !== 'bank' && !cruzados.has(g.id),
  );
  const porId = new Map(anticipo.expenses.map((g) => [g.id, g]));
  const ocupado = (id: string) => accion.isPending && accion.variables?.movimientoId === id;
  const hacer = (movimientoId: string, a: Parameters<typeof accion.mutate>[0]['accion']) =>
    accion.mutate({ extractoId: e.id, movimientoId, accion: a });

  return (
    <Tarjeta className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {e.file_name}
            {e.card_last4 && <span className="text-slate-500"> · tarjeta ****{e.card_last4}</span>}
          </p>
          <p className="text-xs text-slate-500">
            {e.currency} · cargado {formatoMomento(e.uploaded_at)}
          </p>
        </div>
        {pendientes > 0 ? (
          <Insignia tono="aviso">{pendientes === 1 ? '1 por decidir' : `${pendientes} por decidir`}</Insignia>
        ) : (
          <Insignia tono="exito">Conciliado</Insignia>
        )}
      </div>
      {accion.isError && <Alerta tono="peligro">{mensajeDeError(accion.error)}</Alerta>}
      <ul className="divide-y divide-slate-100">
        {cargos.map((m) => {
          const gasto = m.expense_id ? porId.get(m.expense_id) : undefined;
          const e2 = estado(m);
          return (
            <li key={m.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-medium">{m.description}</p>
                  <p className="text-xs text-slate-500">
                    {formatoFechaCalendario(m.day)} · fila {m.row}
                    {m.reference && ` · ref. ${m.reference}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="whitespace-nowrap font-semibold">{formatoDinero(Math.abs(Number(m.amount)), e.currency)}</span>
                  <Insignia tono={e2.tono}>{e2.texto}</Insignia>
                </div>
              </div>
              {gasto && <FacturaCruzada gasto={gasto} puntaje={m.match_score} />}
              {decide && (
                <div className="flex flex-wrap justify-end gap-2">
                  {(m.match_status === 'auto' || m.match_status === 'suggested') && (
                    <Boton cargando={ocupado(m.id)} onClick={() => hacer(m.id, { tipo: 'confirmar' })}>
                      Confirmar
                    </Boton>
                  )}
                  {m.match_status && (
                    <Boton variante="fantasma" className="text-red-700" disabled={ocupado(m.id)} onClick={() => hacer(m.id, { tipo: 'deshacer' })}>
                      No corresponde
                    </Boton>
                  )}
                  {!m.expense_id && (
                    <>
                      {libres.length > 0 && <Enlazar cargo={m.description} libres={libres} ocupado={ocupado(m.id)} alEnlazar={(gastoId) => hacer(m.id, { tipo: 'enlazar', gastoId })} />}
                      {m.charge_decision !== 'absorb' && (
                        <Boton variante="secundario" disabled={ocupado(m.id)} onClick={() => hacer(m.id, { tipo: 'decidir', decision: 'absorb' })}>
                          Lo asume la empresa
                        </Boton>
                      )}
                      {m.charge_decision !== 'discount' && (
                        <Boton variante="secundario" disabled={ocupado(m.id)} onClick={() => hacer(m.id, { tipo: 'decidir', decision: 'discount' })}>
                          Descontar al viajero
                        </Boton>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {fuera.length > 0 && (
        <details className="text-sm text-slate-600">
          <summary>{fuera.length === 1 ? '1 cargo fuera de las fechas del viaje' : `${fuera.length} cargos fuera de las fechas del viaje`} (no son de esta legalización)</summary>
          <ul className="mt-2 space-y-1">
            {fuera.map((m) => (
              <li key={m.id}>
                {formatoFechaCalendario(m.day)} · {m.description} · {formatoDinero(Math.abs(Number(m.amount)), e.currency)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Tarjeta>
  );
}

function FacturaCruzada({ gasto, puntaje }: { gasto: Gasto; puntaje: string | null }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-sm">
      Factura de <span className="font-semibold">{gasto.vendor_name ?? 'proveedor sin nombre'}</span> del {formatoFechaCalendario(gasto.invoice_date)} por{' '}
      {formatoDinero(gasto.amount_before_bank ?? gasto.total, gasto.currency)}
      {gasto.bank_status === 'matched' && gasto.bank_amount && (
        <span className="text-slate-600"> · se legaliza por lo que cobró el banco: {formatoDinero(gasto.bank_amount, gasto.bank_currency)}</span>
      )}
      {puntaje !== null && <span className="text-xs text-slate-500"> · coincidencia {Math.round(Number(puntaje) * 100)} %</span>}
    </div>
  );
}

function Enlazar({
  cargo,
  libres,
  ocupado,
  alEnlazar,
}: {
  cargo: string;
  libres: Gasto[];
  ocupado: boolean;
  alEnlazar: (gastoId: string) => void;
}) {
  const [elegido, setElegido] = useState('');
  return (
    <div className="flex items-center gap-2">
      <Seleccion aria-label={`Factura para el cargo ${cargo}`} className="w-auto" value={elegido} onChange={(ev) => setElegido(ev.target.value)}>
        <option value="">Elegir factura…</option>
        {libres.map((g) => (
          <option key={g.id} value={g.id}>
            {g.vendor_name ?? 'Sin proveedor'} · {formatoFechaCalendario(g.invoice_date)} · {formatoDinero(g.total, g.currency)}
          </option>
        ))}
      </Seleccion>
      <Boton variante="secundario" disabled={!elegido} cargando={ocupado} onClick={() => alEnlazar(elegido)}>
        Cruzar
      </Boton>
    </div>
  );
}
