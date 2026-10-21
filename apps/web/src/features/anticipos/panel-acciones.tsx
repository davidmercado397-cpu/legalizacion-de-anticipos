import { useAccionAnticipo, useSesion, useSugerenciasDevolucion } from '@viaticos/client-app';
import type { AnticipoDetalle, MetodoDesembolso, MetodoLiquidacion } from '@viaticos/contracts';
import { Send } from 'lucide-react';
import { useId, useState } from 'react';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { puede } from '../../lib/roles';
import { Boton } from '../../ui/boton';
import { AreaTexto, Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';
import { puedeDecidir } from './ruta-aprobacion';

type Formulario = 'rechazar' | 'devolver' | 'anular' | 'reabrir' | 'desembolsar' | 'liquidar' | null;

/**
 * Las acciones que tiene sentido ofrecer según el estado y el rol. La API es la que decide: si alguien
 * no puede, responde con el motivo (p. ej. nadie aprueba lo suyo).
 */
export function PanelAcciones({ anticipo }: { anticipo: AnticipoDetalle }) {
  const usuario = useSesion((s) => s.usuario);
  const accion = useAccionAnticipo(anticipo.id);
  const [abierto, setAbierto] = useState<Formulario>(null);
  const propio = usuario?.id === anticipo.employee_id;
  const aprueba = puedeDecidir(anticipo, usuario);
  const contable = puede(usuario, 'contabilidad');
  const revisa = !propio && contable;
  const tesoreria = puede(usuario, 'tesoreria');
  const s = anticipo.status;
  const idMotivo = useId();

  const botones: React.ReactNode[] = [];
  if (s === 'requested' && propio)
    botones.push(
      <Boton key="cancelar" variante="secundario" cargando={accion.isPending} onClick={() => accion.mutate({ tipo: 'cancelar' })}>
        Cancelar solicitud
      </Boton>,
    );
  if (s === 'requested' && aprueba)
    botones.push(
      <Boton key="aprobar" cargando={accion.isPending} onClick={() => accion.mutate({ tipo: 'aprobar' })}>
        Aprobar
      </Boton>,
      <Boton key="rechazar" variante="peligro" onClick={() => setAbierto('rechazar')}>
        Rechazar
      </Boton>,
    );
  // La API no deja enviar con facturas sin confirmar: el botón lo dice antes de que lo intente.
  const sinConfirmar = anticipo.expenses.filter((g) => ['received', 'processing', 'extracted'].includes(g.status)).length;
  const motivo =
    s === 'approved' && propio && sinConfirmar > 0
      ? `Primero confirma ${sinConfirmar === 1 ? 'la factura pendiente' : `las ${sinConfirmar} facturas pendientes`}`
      : null;
  if (s === 'approved' && propio)
    botones.push(
      <Boton
        key="enviar"
        cargando={accion.isPending}
        disabled={motivo !== null}
        aria-describedby={motivo ? idMotivo : undefined}
        onClick={() => accion.mutate({ tipo: 'enviar' })}
      >
        <Send aria-hidden />
        Enviar legalización a revisión
      </Boton>,
    );
  if (s === 'in_review' && revisa)
    botones.push(
      <Boton key="cerrar" cargando={accion.isPending} onClick={() => accion.mutate({ tipo: 'cerrar' })}>
        Aprobar legalización
      </Boton>,
      <Boton key="devolver" variante="secundario" onClick={() => setAbierto('devolver')}>
        Devolver para corregir
      </Boton>,
    );
  if (s === 'approved' && tesoreria && !anticipo.disbursed_at)
    botones.push(
      <Boton key="desembolsar" variante="secundario" onClick={() => setAbierto('desembolsar')}>
        Registrar desembolso
      </Boton>,
    );
  if (s === 'approved' && contable && anticipo.balance.expenses_count === 0)
    botones.push(
      <Boton key="anular" variante="fantasma" onClick={() => setAbierto('anular')}>
        Anular
      </Boton>,
    );
  if (s === 'closed' && tesoreria && (anticipo.settlement_status === 'refund_pending' || anticipo.settlement_status === 'payment_pending'))
    botones.push(
      <Boton key="liquidar" onClick={() => setAbierto('liquidar')}>
        Registrar {anticipo.settlement_status === 'refund_pending' ? 'reintegro' : 'reembolso'}
      </Boton>,
    );
  if (s === 'closed' && contable && ['refund_pending', 'payment_pending', 'none'].includes(anticipo.settlement_status ?? ''))
    botones.push(
      <Boton key="reabrir" variante="fantasma" onClick={() => setAbierto('reabrir')}>
        Reabrir
      </Boton>,
    );

  // Siesa (decisión 8.1): el anticipo se crea solo al aprobarse; si falló, contabilidad lo reintenta.
  if (s === 'closed' && contable && anticipo.erp_legalization_status !== 'sent')
    botones.unshift(
      <Boton key="siesa-legalizacion" cargando={accion.isPending} onClick={() => accion.mutate({ tipo: 'siesa_legalizacion' })}>
        Crear legalización en Siesa
      </Boton>,
    );
  else if (['approved', 'in_review'].includes(s) && contable && anticipo.erp_advance_status !== 'sent')
    botones.push(
      <Boton
        key="siesa-anticipo"
        variante="secundario"
        cargando={accion.isPending}
        onClick={() => accion.mutate({ tipo: 'siesa_anticipo' })}
      >
        Reintentar envío a Siesa
      </Boton>,
    );

  if (botones.length === 0 && !accion.isError) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {botones}
        {motivo && (
          <p id={idMotivo} className="text-sm text-slate-600">
            {motivo}
          </p>
        )}
      </div>
      {accion.isError && <Alerta tono="peligro">{mensajeDeError(accion.error)}</Alerta>}
      {abierto && (
        <Tarjeta>
          {abierto === 'rechazar' && (
            <FormularioNota
              titulo="Motivo del rechazo"
              opcional
              accion="Rechazar"
              cargando={accion.isPending}
              alEnviar={(nota) => accion.mutate({ tipo: 'rechazar', nota: nota || null }, { onSuccess: () => setAbierto(null) })}
              alCancelar={() => setAbierto(null)}
            />
          )}
          {(abierto === 'anular' || abierto === 'reabrir') && (
            <FormularioNota
              titulo={abierto === 'anular' ? 'Por qué se anula (p. ej. viaje cancelado)' : 'Por qué se reabre'}
              accion={abierto === 'anular' ? 'Anular' : 'Reabrir'}
              cargando={accion.isPending}
              alEnviar={(nota) => accion.mutate({ tipo: abierto, nota }, { onSuccess: () => setAbierto(null) })}
              alCancelar={() => setAbierto(null)}
            />
          )}
          {abierto === 'devolver' && <FormularioDevolucion anticipo={anticipo} alTerminar={() => setAbierto(null)} />}
          {abierto === 'desembolsar' && (
            <FormularioTesoreria
              titulo="Desembolso"
              opciones={['transfer', 'cash', 'card'] satisfies MetodoDesembolso[]}
              grupo="desembolso"
              cargando={accion.isPending}
              entrega={
                anticipo.settlement_currency ? { moneda: anticipo.settlement_currency, estimado: anticipo.settlement_amount } : undefined
              }
              alEnviar={(method, reference, amount) =>
                accion.mutate(
                  { tipo: 'desembolsar', datos: { method: method as MetodoDesembolso, reference, amount } },
                  { onSuccess: () => setAbierto(null) },
                )
              }
              alCancelar={() => setAbierto(null)}
            />
          )}
          {abierto === 'liquidar' && (
            <FormularioTesoreria
              titulo="Liquidación de la diferencia"
              opciones={
                (anticipo.settlement_status === 'refund_pending'
                  ? ['refund', 'payroll_deduction']
                  : ['payment']) satisfies MetodoLiquidacion[]
              }
              grupo="metodoLiquidacion"
              cargando={accion.isPending}
              alEnviar={(method, reference) =>
                accion.mutate(
                  { tipo: 'liquidar', datos: { method: method as MetodoLiquidacion, reference } },
                  { onSuccess: () => setAbierto(null) },
                )
              }
              alCancelar={() => setAbierto(null)}
            />
          )}
        </Tarjeta>
      )}
    </div>
  );
}

function FormularioNota(props: {
  titulo: string;
  accion: string;
  opcional?: boolean;
  cargando: boolean;
  alEnviar: (nota: string) => void;
  alCancelar: () => void;
}) {
  const [nota, setNota] = useState('');
  const valida = props.opcional || nota.trim().length >= 3;
  return (
    <div className="space-y-2">
      <Campo etiqueta={props.titulo}>{(p) => <AreaTexto {...p} value={nota} onChange={(e) => setNota(e.target.value)} />}</Campo>
      <div className="flex gap-2">
        <Boton disabled={!valida} cargando={props.cargando} onClick={() => props.alEnviar(nota.trim())}>
          {props.accion}
        </Boton>
        <Boton variante="fantasma" onClick={props.alCancelar}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}

function FormularioTesoreria(props: {
  titulo: string;
  opciones: string[];
  grupo: string;
  cargando: boolean;
  /** Anticipo calculado en otra moneda: lo entregado en la de la compañía (vacío = con la tasa de hoy). */
  entrega?: { moneda: string; estimado: string | null };
  alEnviar: (metodo: string, referencia: string | null, valor: string | null) => void;
  alCancelar: () => void;
}) {
  const [metodo, setMetodo] = useState(props.opciones[0] ?? '');
  const [referencia, setReferencia] = useState('');
  const [valor, setValor] = useState('');
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <h3 className="font-semibold sm:col-span-2">{props.titulo}</h3>
      <Campo etiqueta="Medio">
        {(p) => (
          <Seleccion {...p} value={metodo} onChange={(e) => setMetodo(e.target.value)}>
            {props.opciones.map((o) => (
              <option key={o} value={o}>
                {etiqueta(props.grupo, o)}
              </option>
            ))}
          </Seleccion>
        )}
      </Campo>
      <Campo etiqueta="Referencia (opcional)">
        {(p) => (
          <Entrada {...p} value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Comprobante, consignación…" />
        )}
      </Campo>
      {props.entrega && (
        <Campo
          etiqueta={`Valor entregado (${props.entrega.moneda})`}
          className="sm:col-span-2"
          ayuda={`Vacío = se calcula con la tasa de hoy${props.entrega.estimado ? ` (al pedirlo se estimó en ${formatoDinero(props.entrega.estimado, props.entrega.moneda)})` : ''}. Escríbelo si entregaste otro valor.`}
        >
          {(p) => <Entrada {...p} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />}
        </Campo>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Boton
          cargando={props.cargando}
          onClick={() => props.alEnviar(metodo, referencia.trim() || null, valor.trim().replace(',', '.') || null)}
        >
          Registrar
        </Boton>
        <Boton variante="fantasma" onClick={props.alCancelar}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}

/** Devolver con los gastos marcados: la API sugiere cuáles y con qué comentario. */
function FormularioDevolucion({ anticipo, alTerminar }: { anticipo: AnticipoDetalle; alTerminar: () => void }) {
  const accion = useAccionAnticipo(anticipo.id);
  const sugerencias = useSugerenciasDevolucion(anticipo.id, true);
  const [nota, setNota] = useState('');
  const [marcas, setMarcas] = useState<Record<string, string> | null>(null);
  const actuales = marcas ?? Object.fromEntries((sugerencias.data ?? []).map((s) => [s.expense_id, s.note]));
  const confirmados = anticipo.expenses.filter((g) => g.status === 'confirmed');

  return (
    <div className="space-y-3">
      <Campo etiqueta="Comentario general (opcional)">
        {(p) => <AreaTexto {...p} value={nota} onChange={(e) => setNota(e.target.value)} />}
      </Campo>
      {confirmados.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Gastos que debe corregir</legend>
          {confirmados.map((g) => {
            const marcado = g.id in actuales;
            return (
              <div key={g.id} className="rounded-lg ring-1 ring-slate-200 p-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={(e) => {
                      const siguiente = { ...actuales };
                      if (e.target.checked) siguiente[g.id] = '';
                      else delete siguiente[g.id];
                      setMarcas(siguiente);
                    }}
                  />
                  {g.vendor_name ?? 'Sin proveedor'} · {g.invoice_date ? formatoFechaCalendario(g.invoice_date) : 'sin fecha'}
                </label>
                {marcado && (
                  <Entrada
                    className="mt-2"
                    aria-label={`Qué debe corregir en ${g.vendor_name ?? 'el gasto'}`}
                    value={actuales[g.id]}
                    onChange={(e) => setMarcas({ ...actuales, [g.id]: e.target.value })}
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      )}
      {accion.isError && <Alerta tono="peligro">{mensajeDeError(accion.error)}</Alerta>}
      <div className="flex gap-2">
        <Boton
          cargando={accion.isPending}
          onClick={() =>
            accion.mutate(
              {
                tipo: 'devolver',
                datos: { note: nota.trim() || null, items: Object.entries(actuales).map(([expense_id, note]) => ({ expense_id, note })) },
              },
              { onSuccess: alTerminar },
            )
          }
        >
          Devolver
        </Boton>
        <Boton variante="fantasma" onClick={alTerminar}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}
