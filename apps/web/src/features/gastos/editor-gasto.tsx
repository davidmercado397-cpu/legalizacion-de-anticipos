import { zodResolver } from '@hookform/resolvers/zod';
import {
  useCategorias,
  useConceptosBloqueados,
  useConfirmarGasto,
  useCorregirGasto,
  useCorregirLinea,
  useDescartarGasto,
  useRevisarGasto,
  useSesion,
} from '@viaticos/client-app';
import type { AnticipoDetalle, CorreccionGasto, DecisionRevision, GastoDetalle, MedioDePago, TipoDocumento } from '@viaticos/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { opcionesDeMoneda } from '../../lib/monedas';
import { puede } from '../../lib/roles';
import { Boton } from '../../ui/boton';
import { AreaTexto, Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Insignia, Tarjeta } from '../../ui/superficies';
import { InsigniaGasto, hallazgos } from './componentes';
import { TarjetaDeducibilidad } from './deducibilidad';
import { sinRechazo } from '../../lib/sin-rechazo';

const decimal = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d+([.,]\d{1,2})?$/.test(v), 'validation.decimal');

const esquema = z.object({
  document_type: z.string(),
  vendor_name: z.string().trim(),
  vendor_tax_id: z.string().trim(),
  invoice_number: z.string().trim(),
  invoice_date: z.string(),
  currency: z.string().trim().toUpperCase(),
  subtotal: decimal,
  tax_amount: decimal,
  tip_amount: decimal,
  discount_amount: decimal,
  total: decimal,
  category: z.string(),
  description: z.string().trim(),
  payment_method: z.string(),
});
type Datos = z.infer<typeof esquema>;
const CAMPOS = Object.keys(esquema.shape) as (keyof Datos)[];
const NUMERICOS = new Set<keyof Datos>(['subtotal', 'tax_amount', 'tip_amount', 'discount_amount', 'total']);

const aFormulario = (g: GastoDetalle): Datos =>
  Object.fromEntries(CAMPOS.map((c) => [c, (g[c] as string | null) ?? ''])) as Datos;

/** Solo se envía lo que el usuario cambió; vacío = sin dato. */
function cambios(datos: Datos, original: Datos): CorreccionGasto {
  const salida: Record<string, string | null> = {};
  for (const campo of CAMPOS) {
    if (datos[campo] === original[campo]) continue;
    const valor = datos[campo];
    salida[campo] = valor === '' ? null : NUMERICOS.has(campo) ? valor.replace(',', '.') : valor;
  }
  return salida as CorreccionGasto;
}

export function EditorGasto({ anticipo, gasto }: { anticipo: AnticipoDetalle; gasto: GastoDetalle }) {
  const usuario = useSesion((s) => s.usuario);
  const propio = usuario?.id === gasto.employee_id;
  const editable = propio && anticipo.status === 'approved' && ['extracted', 'failed', 'confirmed'].includes(gasto.status);
  // Mientras la IA la lee (o la reintenta) no se edita, pero sí se puede descartar: una foto equivocada no debe esperar.
  const enLectura = propio && anticipo.status === 'approved' && ['received', 'processing', 'unreadable'].includes(gasto.status);
  const revisa = !propio && puede(usuario, 'contabilidad') && anticipo.status === 'in_review';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Tarjeta className="space-y-3 self-start">
        <Foto gasto={gasto} />
        <div className="flex flex-wrap gap-2">
          <InsigniaGasto estado={gasto.status} />
          <Insignia tono={gasto.review_status === 'pending' ? 'aviso' : 'neutro'}>{etiqueta('revision', gasto.review_status)}</Insignia>
        </div>
        {gasto.status === 'unreadable' && (
          <Alerta tono="peligro">No se pudo leer la foto. Tómela de nuevo con buena luz y súbala otra vez.</Alerta>
        )}
        {(gasto.status === 'received' || gasto.status === 'processing') && (
          <Alerta tono={gasto.last_error ? 'aviso' : 'info'}>
            {gasto.last_error
              ? 'La lectura automática falló y se intentará de nuevo. Si sigue fallando, en unos minutos podrá completar los datos a mano.'
              : 'Estamos leyendo la factura. En unos segundos aparecen los datos para que los revise.'}
          </Alerta>
        )}
        {enLectura && <BotonDescartar gastoId={gasto.id} />}
      </Tarjeta>
      <div className="space-y-4">
        {gasto.return_note && !gasto.return_resolved_at && (
          <Alerta tono="peligro" titulo="Su aprobador pidió corregir">
            {gasto.return_note}
          </Alerta>
        )}
        <Hallazgos gasto={gasto} />
        <OrigenEfectivo anticipo={anticipo} gasto={gasto} />
        {editable ? <Formulario anticipo={anticipo} gasto={gasto} /> : <Resumen gasto={gasto} />}
        <Lineas gasto={gasto} companiaId={anticipo.company_id} editable={editable || revisa} />
        {revisa && (gasto.review_status === 'pending' || gasto.status === 'confirmed') && <Revision gasto={gasto} />}
        {!propio && puede(usuario, 'contabilidad') && gasto.status === 'confirmed' && <TarjetaDeducibilidad gasto={gasto} />}
      </div>
    </div>
  );
}

function BotonDescartar({ gastoId }: { gastoId: string }) {
  const descartar = useDescartarGasto();
  return (
    <div className="space-y-2">
      <Boton variante="secundario" cargando={descartar.isPending} onClick={() => descartar.mutate(gastoId)}>
        Descartar esta factura
      </Boton>
      {descartar.isError && <Alerta tono="peligro">{mensajeDeError(descartar.error)}</Alerta>}
    </div>
  );
}

function Foto({ gasto }: { gasto: GastoDetalle }) {
  if (!gasto.file) return <div className="aspect-[3/4] rounded-lg bg-slate-100" />;
  if (gasto.file.mime_type === 'application/pdf')
    return (
      <a href={gasto.file.url} target="_blank" rel="noreferrer" className="font-semibold text-marca-700 underline">
        Abrir el PDF de la factura
      </a>
    );
  return (
    <a href={gasto.file.url} target="_blank" rel="noreferrer">
      <img src={gasto.file.url} alt="Foto de la factura" className="w-full rounded-lg object-contain" />
    </a>
  );
}

const TONO_ACCION: Record<string, 'peligro' | 'aviso' | 'info'> = { block: 'peligro', require_justification: 'aviso', review: 'aviso' };

/** Pagado en efectivo en otra moneda: de qué retiros salió y con qué tasa se legaliza (decisión 9.4). */
function OrigenEfectivo({ anticipo, gasto }: { anticipo: AnticipoDetalle; gasto: GastoDetalle }) {
  if (gasto.cash_allocations.length === 0 && !gasto.cash_uncovered) return null;
  const fecha = (id: string) => anticipo.withdrawals.find((r) => r.id === id)?.withdrawn_on;
  const tasa = (valor: string) => Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  return (
    <Alerta tono="info" titulo="Pagado en efectivo">
      <ul className="list-disc space-y-0.5 pl-5">
        {gasto.cash_allocations.map((d) => (
          <li key={d.withdrawal_id}>
            {formatoDinero(d.amount, gasto.currency)} del retiro del {formatoFechaCalendario(fecha(d.withdrawal_id))}, a {tasa(d.rate)}
          </li>
        ))}
        {gasto.cash_uncovered && (
          <li>{formatoDinero(gasto.cash_uncovered, gasto.currency)} sin un retiro que lo cubra: va con la tasa del día de la factura</li>
        )}
      </ul>
      {gasto.amount_applied && (
        <p className="mt-1">
          Se legaliza por {formatoDinero(gasto.amount_applied, anticipo.balance.currency)}.
        </p>
      )}
    </Alerta>
  );
}

function Hallazgos({ gasto }: { gasto: GastoDetalle }) {
  const lista = hallazgos(gasto);
  if (lista.length === 0) return null;
  return (
    <ul className="space-y-2">
      {lista.map((h, i) => (
        <li key={`${h.rule}-${i}`}>
          <Alerta tono={TONO_ACCION[h.action ?? ''] ?? 'info'} titulo={etiqueta('regla', h.rule)}>
            {h.message ?? etiqueta('accion', h.action)}
          </Alerta>
        </li>
      ))}
    </ul>
  );
}

function Resumen({ gasto }: { gasto: GastoDetalle }) {
  const filas: [string, React.ReactNode][] = [
    ['Tipo de documento', etiqueta('documento', gasto.document_type)],
    ['Proveedor', gasto.vendor_name ?? '—'],
    ['NIT', gasto.vendor_tax_id ?? '—'],
    ['Número', gasto.invoice_number ?? '—'],
    ['Fecha', gasto.invoice_date ?? '—'],
    ['Subtotal', formatoDinero(gasto.subtotal, gasto.currency)],
    ['Impuestos', formatoDinero(gasto.tax_amount, gasto.currency)],
    ['Propina', formatoDinero(gasto.tip_amount, gasto.currency)],
    ['Descuento', formatoDinero(gasto.discount_amount, gasto.currency)],
    ['Medio de pago', etiqueta('medio', gasto.payment_method)],
    ['Total', formatoDinero(gasto.total, gasto.currency)],
    ['Justificación', gasto.justification ?? '—'],
  ];
  if (gasto.document_type === 'cash_receipt') filas.splice(1, 0, ['Firmado por quien vende', gasto.receipt_signed ? 'Sí' : 'No']);
  if (gasto.bank_status === 'matched' && gasto.bank_amount)
    filas.push(['Cobrado por el banco', formatoDinero(gasto.bank_amount, gasto.bank_currency)]);
  if (gasto.non_reimbursable_amount) filas.push(['No reembolsable', formatoDinero(gasto.non_reimbursable_amount, null)]);
  return (
    <Tarjeta>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {filas.map(([nombre, valor]) => (
          <div key={nombre} className="contents">
            <dt className="text-slate-500">{nombre}</dt>
            <dd className="font-medium">{valor}</dd>
          </div>
        ))}
      </dl>
    </Tarjeta>
  );
}

function Formulario({ anticipo, gasto }: { anticipo: AnticipoDetalle; gasto: GastoDetalle }) {
  const usuario = useSesion((s) => s.usuario);
  const categorias = useCategorias(anticipo.company_id);
  const corregir = useCorregirGasto();
  const confirmar = useConfirmarGasto();
  const descartar = useDescartarGasto();
  const original = aFormulario(gasto);
  const { register, handleSubmit, formState, reset, watch } = useForm<Datos>({ resolver: zodResolver(esquema), values: original });
  const [firmado, setFirmado] = useState(gasto.receipt_signed);
  const esRecibo = watch('document_type') === 'cash_receipt';
  const [justificacion, setJustificacion] = useState(gasto.justification ?? '');
  const [convertido, setConvertido] = useState('');
  // Si declara la firma, ese hallazgo desaparece al confirmar y no pide justificación.
  const pideJustificacion = hallazgos(gasto).some((h) => h.action === 'require_justification' && !(firmado && h.code === 'receipt_not_signed'));
  // Se legaliza en la moneda de liquidación (la de la compañía si el anticipo se calculó en otra).
  const monedaLegal = anticipo.balance.currency;
  const otraMoneda = !!gasto.currency && gasto.currency !== monedaLegal;
  const pideConvertido = otraMoneda && !gasto.exchange_rate;
  const error = corregir.error ?? confirmar.error ?? descartar.error;

  const guardar = handleSubmit(sinRechazo(async (datos) => {
    const diferencias = cambios(datos, original);
    if (Object.keys(diferencias).length > 0) await corregir.mutateAsync({ id: gasto.id, cambios: diferencias });
    await confirmar.mutateAsync({
      id: gasto.id,
      datos: {
        advance_id: anticipo.id,
        justification: justificacion.trim() || null,
        receipt_signed: datos.document_type === 'cash_receipt' ? firmado : null,
        amount_applied: convertido ? convertido.replace(',', '.') : null,
      },
    });
    reset(datos);
  }));

  const e = formState.errors;
  return (
    <Tarjeta>
      <form noValidate onSubmit={guardar} className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Tipo de documento">
          {(p) => (
            <Seleccion {...p} {...register('document_type')}>
              <option value="">—</option>
              {(['electronic_invoice', 'pos_ticket', 'cash_receipt', 'other'] satisfies TipoDocumento[]).map((t) => (
                <option key={t} value={t}>
                  {etiqueta('documento', t)}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Categoría">
          {(p) => (
            <Seleccion {...p} {...register('category')}>
              <option value="">—</option>
              {(categorias.data ?? [])
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.emoji} {c.name}
                  </option>
                ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Proveedor">{(p) => <Entrada {...p} {...register('vendor_name')} />}</Campo>
        <Campo etiqueta="NIT del proveedor">{(p) => <Entrada {...p} {...register('vendor_tax_id')} />}</Campo>
        <Campo etiqueta="Número de factura">{(p) => <Entrada {...p} {...register('invoice_number')} />}</Campo>
        <Campo etiqueta="Fecha">{(p) => <Entrada {...p} {...register('invoice_date')} type="date" />}</Campo>
        <Campo etiqueta="Moneda">
          {(p) => (
            <Seleccion {...p} {...register('currency')}>
              <option value="">—</option>
              {opcionesDeMoneda(usuario, gasto.currency).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Total" error={e.total?.message}>
          {(p) => <Entrada {...p} {...register('total')} inputMode="decimal" />}
        </Campo>
        <Campo etiqueta="Subtotal" error={e.subtotal?.message}>
          {(p) => <Entrada {...p} {...register('subtotal')} inputMode="decimal" />}
        </Campo>
        <Campo etiqueta="Impuestos" error={e.tax_amount?.message}>
          {(p) => <Entrada {...p} {...register('tax_amount')} inputMode="decimal" />}
        </Campo>
        <Campo etiqueta="Propina" error={e.tip_amount?.message}>
          {(p) => <Entrada {...p} {...register('tip_amount')} inputMode="decimal" />}
        </Campo>
        <Campo etiqueta="Descuento" ayuda="Lo que la factura rebaja; el total ya lo tiene restado" error={e.discount_amount?.message}>
          {(p) => <Entrada {...p} {...register('discount_amount')} inputMode="decimal" />}
        </Campo>
        <Campo etiqueta="Medio de pago" ayuda="Lo pagado con tarjeta se cruza con el extracto del banco">
          {(p) => (
            <Seleccion {...p} {...register('payment_method')}>
              <option value="">Según el anticipo</option>
              {(['card', 'cash', 'transfer'] satisfies MedioDePago[]).map((m) => (
                <option key={m} value={m}>
                  {etiqueta('medio', m)}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Descripción" className="sm:col-span-2">
          {(p) => <AreaTexto {...p} {...register('description')} rows={2} />}
        </Campo>
        {otraMoneda && (
          <Campo
            etiqueta={`Valor en ${monedaLegal}`}
            className="sm:col-span-2"
            ayuda={
              gasto.exchange_rate_source === 'withdrawal'
                ? `Pagado en efectivo con sus retiros: tasa ${Number(gasto.exchange_rate).toLocaleString('es-CO', { maximumFractionDigits: 2 })}. Déjelo vacío para usar la del retiro.`
                : gasto.exchange_rate
                  ? `Se convierte con la tasa ${gasto.exchange_rate} del ${gasto.exchange_rate_date}. Escríbalo solo si su banco cobró otro valor.`
                  : `No hay tasa automática para esta moneda: escriba cuánto le costó en ${monedaLegal}.`
            }
          >
            {(p) => <Entrada {...p} value={convertido} onChange={(ev) => setConvertido(ev.target.value)} inputMode="decimal" required={pideConvertido} />}
          </Campo>
        )}
        {esRecibo && (
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-1" checked={firmado} onChange={(ev) => setFirmado(ev.target.checked)} />
            <span>
              El recibo está firmado por quien me vendió <span className="text-slate-500">(sin firma, la política pide justificación)</span>
            </span>
          </label>
        )}
        {(pideJustificacion || gasto.justification) && (
          <Campo etiqueta="Justificación" className="sm:col-span-2" ayuda="La política de gastos la pide para este gasto.">
            {(p) => <AreaTexto {...p} value={justificacion} onChange={(ev) => setJustificacion(ev.target.value)} />}
          </Campo>
        )}
        {error && (
          <div className="sm:col-span-2">
            <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>
          </div>
        )}
        {confirmar.isSuccess && !formState.isDirty && (
          <div className="sm:col-span-2">
            <Alerta tono="exito">Gasto confirmado.</Alerta>
          </div>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Boton type="submit" cargando={corregir.isPending || confirmar.isPending}>
            {gasto.status === 'confirmed' ? 'Guardar cambios' : 'Está bien: confirmar'}
          </Boton>
          <Boton variante="fantasma" cargando={descartar.isPending} onClick={() => descartar.mutate(gasto.id)}>
            Descartar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}

function Lineas({ gasto, companiaId, editable }: { gasto: GastoDetalle; companiaId: string; editable: boolean }) {
  const conceptos = useConceptosBloqueados(companiaId);
  const corregir = useCorregirLinea();
  if (gasto.lines.length === 0) return null;
  const nombre = (codigo: string | null) => (codigo ? (conceptos.data?.find((c) => c.code === codigo)?.name ?? codigo) : null);
  return (
    <Tarjeta className="space-y-2">
      <h2 className="font-semibold">Líneas de la factura</h2>
      <ul className="divide-y divide-slate-100">
        {gasto.lines.map((l) => {
          const concepto = l.final_concept_code;
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{l.description}</p>
                <p className="text-slate-500">
                  {l.quantity && `${l.quantity} × `}
                  {formatoDinero(l.amount, gasto.currency)}
                  {l.similar_concept_code && !concepto && ` · se parece a ${nombre(l.similar_concept_code)}`}
                </p>
              </div>
              {editable ? (
                <Seleccion
                  aria-label={`Concepto de ${l.description}`}
                  className="w-auto"
                  value={concepto ?? ''}
                  disabled={corregir.isPending}
                  onChange={(e) => corregir.mutate({ id: gasto.id, lineaId: l.id, concepto: e.target.value || null })}
                >
                  <option value="">Permitido</option>
                  {(conceptos.data ?? [])
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.code} value={c.code}>
                        No permitido: {c.name}
                      </option>
                    ))}
                </Seleccion>
              ) : (
                concepto && <Insignia tono="peligro">{nombre(concepto)}</Insignia>
              )}
            </li>
          );
        })}
      </ul>
      {corregir.isError && <Alerta tono="peligro">{mensajeDeError(corregir.error)}</Alerta>}
    </Tarjeta>
  );
}

function Revision({ gasto }: { gasto: GastoDetalle }) {
  const revisar = useRevisarGasto();
  const [nota, setNota] = useState('');
  const decidir = (decision: DecisionRevision) => revisar.mutate({ id: gasto.id, decision, nota: nota.trim() || null });
  return (
    <Tarjeta className="space-y-3">
      <h2 className="font-semibold">Su decisión sobre este gasto</h2>
      {gasto.suggested_non_reimbursable && (
        <p className="text-sm text-slate-600">
          Lo no permitido suma {formatoDinero(gasto.suggested_non_reimbursable, gasto.currency)} con su parte de impuestos.
        </p>
      )}
      <Campo etiqueta="Comentario" ayuda="Obligatorio si acepta el gasto completo pese a la política.">
        {(p) => <AreaTexto {...p} value={nota} onChange={(e) => setNota(e.target.value)} rows={2} />}
      </Campo>
      <div className="flex flex-wrap gap-2">
        <Boton cargando={revisar.isPending} onClick={() => decidir('accept_without_blocked')}>
          Aceptar sin lo no permitido
        </Boton>
        <Boton variante="secundario" cargando={revisar.isPending} onClick={() => decidir('accept_full')}>
          Aceptar completo
        </Boton>
        <Boton variante="peligro" cargando={revisar.isPending} onClick={() => decidir('reject')}>
          Rechazar
        </Boton>
      </div>
      {revisar.isError && <Alerta tono="peligro">{mensajeDeError(revisar.error)}</Alerta>}
    </Tarjeta>
  );
}
