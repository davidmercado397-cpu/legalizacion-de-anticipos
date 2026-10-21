import { useRetiro, useSesion } from '@viaticos/client-app';
import type { AnticipoDetalle, Retiro } from '@viaticos/contracts';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { opcionesDeMoneda } from '../../lib/monedas';
import { puede } from '../../lib/roles';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Seccion } from '../../ui/pagina';
import { Alerta, Insignia, Tarjeta } from '../../ui/superficies';

const decimal = (texto: string) => texto.trim().replace(',', '.');
const tasa = (valor: string | null) => (valor ? Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 2 }) : '—');

/**
 * Retiros de efectivo en otra moneda (decisiones 9.4 a 9.6): cada uno es una bolsa con la tasa del día del retiro, o la
 * que cobró el banco. Las facturas pagadas en efectivo en esa moneda la gastan en orden. El viajero los registra
 * mientras el anticipo está abierto; tesorería completa después lo debitado y la comisión, hasta que se cierra.
 */
export function SeccionRetiros({ anticipo }: { anticipo: AnticipoDetalle }) {
  const usuario = useSesion((s) => s.usuario);
  const propio = usuario?.id === anticipo.employee_id;
  const abierto = anticipo.status === 'approved';
  const tesoreria = puede(usuario, 'tesoreria') && !propio && (anticipo.status === 'approved' || anticipo.status === 'in_review');
  const [nuevo, setNuevo] = useState(false);
  const moneda = anticipo.balance.currency;
  // Cualquier anticipo abierto del viajero acepta retiros, también los creados antes de la moneda de liquidación.
  const visible = anticipo.withdrawals.length > 0 || (propio && abierto);
  if (!visible) return null;

  return (
    <Seccion
      titulo="Retiros en efectivo"
      acciones={
        propio &&
        abierto &&
        !nuevo && (
          <Boton variante="secundario" tamano="pequeno" onClick={() => setNuevo(true)}>
            <Plus aria-hidden />
            Registrar retiro
          </Boton>
        )
      }
    >
      <p className="max-w-prose text-sm text-slate-600">
        Cada retiro es una bolsa con su tasa. Las facturas que pagues en efectivo en esa moneda la van gastando en orden, y se
        legalizan en {moneda} con la tasa del retiro del que salieron.
      </p>
      {nuevo && <FormularioRetiro anticipo={anticipo} alTerminar={() => setNuevo(false)} />}
      {anticipo.withdrawals.map((r) => (
        <TarjetaRetiro key={r.id} anticipo={anticipo} retiro={r} editaViajero={propio && abierto} editaTesoreria={tesoreria} />
      ))}
    </Seccion>
  );
}

function TarjetaRetiro({
  anticipo,
  retiro: r,
  editaViajero,
  editaTesoreria,
}: {
  anticipo: AnticipoDetalle;
  retiro: Retiro;
  editaViajero: boolean;
  editaTesoreria: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const accion = useRetiro(anticipo.id);
  const moneda = anticipo.balance.currency;
  const delBanco = r.debited_amount !== null;
  return (
    <Tarjeta className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          {formatoDinero(r.amount, r.currency)} <span className="font-normal text-slate-500">el {formatoFechaCalendario(r.withdrawn_on)}</span>
        </p>
        <Insignia tono={Number(r.remaining) > 0 ? 'info' : 'neutro'}>Quedan {formatoDinero(r.remaining, r.currency)}</Insignia>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Tasa</dt>
          <dd>
            {tasa(r.rate)} <span className="text-xs text-slate-500">{delBanco ? '(del banco)' : '(oficial del día)'}</span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Costó en {moneda}</dt>
          <dd>{formatoDinero(r.value, moneda)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Comisión</dt>
          <dd>{r.fee_amount ? formatoDinero(r.fee_amount, moneda) : 'Sin registrar'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Tasa oficial</dt>
          <dd>{tasa(r.official_rate)}</dd>
        </div>
      </dl>
      {r.note && <p className="text-sm text-slate-600">“{r.note}”</p>}
      {accion.isError && <Alerta tono="peligro">{mensajeDeError(accion.error)}</Alerta>}
      {editando ? (
        <FormularioRetiro anticipo={anticipo} retiro={r} soloBanco={editaTesoreria && !editaViajero} alTerminar={() => setEditando(false)} />
      ) : (
        (editaViajero || editaTesoreria) && (
          <div className="flex flex-wrap gap-2">
            <Boton variante="secundario" onClick={() => setEditando(true)}>
              {editaViajero ? 'Corregir' : 'Registrar lo debitado y la comisión'}
            </Boton>
            {editaViajero && (
              <Boton
                variante="fantasma"
                cargando={accion.isPending}
                onClick={() => {
                  if (window.confirm('¿Borrar este retiro? Las facturas que pagó se valoran de nuevo.')) accion.mutate({ tipo: 'borrar', id: r.id });
                }}
              >
                Borrar
              </Boton>
            )}
          </div>
        )
      )}
    </Tarjeta>
  );
}

/** Registrar un retiro, o corregirlo. Tesorería (`soloBanco`) solo completa lo debitado, la comisión y la nota. */
function FormularioRetiro({
  anticipo,
  retiro,
  soloBanco = false,
  alTerminar,
}: {
  anticipo: AnticipoDetalle;
  retiro?: Retiro;
  soloBanco?: boolean;
  alTerminar: () => void;
}) {
  const usuario = useSesion((s) => s.usuario);
  const accion = useRetiro(anticipo.id);
  const moneda = anticipo.balance.currency;
  const monedas = opcionesDeMoneda(usuario, retiro?.currency).filter((m) => m !== moneda);
  const [fecha, setFecha] = useState(retiro?.withdrawn_on ?? '');
  const [divisa, setDivisa] = useState(retiro?.currency ?? (anticipo.currency !== moneda ? anticipo.currency : (monedas[0] ?? '')));
  const [valor, setValor] = useState(retiro?.amount ?? '');
  const [debitado, setDebitado] = useState(retiro?.debited_amount ?? '');
  const [comision, setComision] = useState(retiro?.fee_amount ?? '');
  const [nota, setNota] = useState(retiro?.note ?? '');

  const banco = { debited_amount: debitado ? decimal(debitado) : null, fee_amount: comision ? decimal(comision) : null, note: nota.trim() || null };
  function guardar() {
    if (retiro) {
      const cambios = soloBanco ? banco : { ...banco, withdrawn_on: fecha, currency: divisa, amount: decimal(valor) };
      accion.mutate({ tipo: 'cambiar', id: retiro.id, cambios }, { onSuccess: alTerminar });
    } else {
      accion.mutate({ tipo: 'registrar', datos: { ...banco, withdrawn_on: fecha, currency: divisa, amount: decimal(valor) } }, { onSuccess: alTerminar });
    }
  }

  return (
    <Tarjeta className="grid gap-3 sm:grid-cols-3">
      {!soloBanco && (
        <>
          <Campo etiqueta="Fecha del retiro">{(p) => <Entrada {...p} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />}</Campo>
          <Campo etiqueta="Moneda">
            {(p) => (
              <Seleccion {...p} value={divisa} onChange={(e) => setDivisa(e.target.value)}>
                {monedas.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Seleccion>
            )}
          </Campo>
          <Campo etiqueta={`Valor retirado (${divisa})`}>
            {(p) => <Entrada {...p} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />}
          </Campo>
        </>
      )}
      <Campo etiqueta={`Lo que debitó el banco (${moneda})`} ayuda="Si aún no lo sabe, déjelo vacío: se usa la tasa oficial del día">
        {(p) => <Entrada {...p} inputMode="decimal" value={debitado} onChange={(e) => setDebitado(e.target.value)} />}
      </Campo>
      <Campo etiqueta={`Comisión (${moneda})`} ayuda="Se suma como un gasto del viaje">
        {(p) => <Entrada {...p} inputMode="decimal" value={comision} onChange={(e) => setComision(e.target.value)} />}
      </Campo>
      <Campo etiqueta="Nota (opcional)">{(p) => <Entrada {...p} value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} />}</Campo>
      {accion.isError && (
        <div className="sm:col-span-3">
          <Alerta tono="peligro">{mensajeDeError(accion.error)}</Alerta>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-3">
        <Boton cargando={accion.isPending} disabled={!soloBanco && (!fecha || !valor || !divisa)} onClick={guardar}>
          {retiro ? 'Guardar' : 'Registrar retiro'}
        </Boton>
        <Boton variante="fantasma" onClick={alTerminar}>
          Cancelar
        </Boton>
      </div>
    </Tarjeta>
  );
}
