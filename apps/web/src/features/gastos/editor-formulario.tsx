import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from '@tanstack/react-router';
import { useCategorias, useConfirmarGasto, useCorregirGasto, useDescartarGasto, useSesion } from '@viaticos/client-app';
import type { AnticipoDetalle, Gasto, GastoDetalle, MedioDePago, TipoDocumento } from '@viaticos/contracts';
import { ArrowRight, Check, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { formatoFechaCalendario } from '../../lib/formato';
import { opcionesDeMoneda } from '../../lib/monedas';
import { sinRechazo } from '../../lib/sin-rechazo';
import { Boton, botonClases } from '../../ui/boton';
import { AreaTexto, Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta } from '../../ui/superficies';
import { hallazgos } from './componentes';
import { aFormulario, cambios, esquema, type Datos } from './editor-esquema';

const MONTO = 'text-right tabular-nums';

/** Un grupo de campos con su título: la factura se revisa por partes, no como una lista de 14 campos. */
export function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-bold text-slate-900">{titulo}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function FormularioGasto({ anticipo, gasto, siguiente }: { anticipo: AnticipoDetalle; gasto: GastoDetalle; siguiente?: Gasto }) {
  const usuario = useSesion((s) => s.usuario);
  const categorias = useCategorias(anticipo.company_id);
  const corregir = useCorregirGasto();
  const confirmar = useConfirmarGasto();
  const descartar = useDescartarGasto();
  const original = aFormulario(gasto);
  const { register, handleSubmit, formState, reset, control } = useForm<Datos>({ resolver: zodResolver(esquema), values: original });
  const [firmado, setFirmado] = useState(gasto.receipt_signed);
  const esRecibo = useWatch({ control, name: 'document_type' }) === 'cash_receipt';
  const [justificacion, setJustificacion] = useState(gasto.justification ?? '');
  const [convertido, setConvertido] = useState('');
  // Si declara la firma, ese hallazgo desaparece al confirmar y no pide justificación.
  const pideJustificacion = hallazgos(gasto).some((h) => h.action === 'require_justification' && !(firmado && h.code === 'receipt_not_signed'));
  // Se legaliza en la moneda de liquidación (la de la compañía si el anticipo se calculó en otra).
  const monedaLegal = anticipo.balance.currency;
  const otraMoneda = !!gasto.currency && gasto.currency !== monedaLegal;
  const pideConvertido = otraMoneda && !gasto.exchange_rate;
  const error = corregir.error ?? confirmar.error ?? descartar.error;

  const guardar = handleSubmit(
    sinRechazo(async (datos) => {
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
    }),
  );

  const e = formState.errors;
  return (
    <form noValidate onSubmit={guardar} className="space-y-8">
      <Grupo titulo="Documento">
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
      </Grupo>

      <Grupo titulo="Valores">
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
          {(p) => <Entrada {...p} {...register('total')} inputMode="decimal" className={`${MONTO} font-bold`} />}
        </Campo>
        <Campo etiqueta="Subtotal" error={e.subtotal?.message}>
          {(p) => <Entrada {...p} {...register('subtotal')} inputMode="decimal" className={MONTO} />}
        </Campo>
        <Campo etiqueta="Impuestos" error={e.tax_amount?.message}>
          {(p) => <Entrada {...p} {...register('tax_amount')} inputMode="decimal" className={MONTO} />}
        </Campo>
        <Campo etiqueta="Propina" error={e.tip_amount?.message}>
          {(p) => <Entrada {...p} {...register('tip_amount')} inputMode="decimal" className={MONTO} />}
        </Campo>
        <Campo etiqueta="Descuento" ayuda="El total ya lo tiene restado" error={e.discount_amount?.message}>
          {(p) => <Entrada {...p} {...register('discount_amount')} inputMode="decimal" className={MONTO} />}
        </Campo>
        {otraMoneda && (
          <Campo
            etiqueta={`Valor en ${monedaLegal}`}
            className="sm:col-span-2"
            ayuda={
              gasto.exchange_rate_source === 'withdrawal'
                ? `Pagado en efectivo con tus retiros: tasa ${Number(gasto.exchange_rate).toLocaleString('es-CO', { maximumFractionDigits: 2 })}. Déjalo vacío para usar la del retiro.`
                : gasto.exchange_rate
                  ? `Se convierte con la tasa ${gasto.exchange_rate} del ${formatoFechaCalendario(gasto.exchange_rate_date)}. Escríbelo solo si tu banco cobró otro valor.`
                  : `No hay tasa automática para esta moneda: escribe cuánto te costó en ${monedaLegal}.`
            }
          >
            {(p) => (
              <Entrada
                {...p}
                value={convertido}
                onChange={(ev) => setConvertido(ev.target.value)}
                inputMode="decimal"
                required={pideConvertido}
                className={MONTO}
              />
            )}
          </Campo>
        )}
      </Grupo>

      <Grupo titulo="Pago y soporte">
        <Campo etiqueta="Medio de pago" ayuda="Lo pagado con tarjeta se cruza con el extracto">
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
      </Grupo>

      {error && <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>}
      {confirmar.isSuccess && !formState.isDirty && (
        <Alerta tono="exito" titulo="Factura confirmada">
          <div className="mt-2">
            {siguiente ? (
              <Link
                to="/anticipos/$anticipoId/gastos/$gastoId"
                params={{ anticipoId: anticipo.id, gastoId: siguiente.id }}
                className={botonClases({ variante: 'secundario', tamano: 'pequeno' })}
              >
                Siguiente: {siguiente.vendor_name ?? 'factura sin proveedor'}
                <ArrowRight aria-hidden />
              </Link>
            ) : (
              <Link
                to="/anticipos/$anticipoId"
                params={{ anticipoId: anticipo.id }}
                className={botonClases({ variante: 'secundario', tamano: 'pequeno' })}
              >
                No quedan facturas por resolver: volver al anticipo
              </Link>
            )}
          </div>
        </Alerta>
      )}

      {/* En el celular las acciones quedan a la mano mientras se recorre el formulario. */}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Boton type="submit" cargando={corregir.isPending || confirmar.isPending}>
          <Check aria-hidden />
          {gasto.status === 'confirmed' ? 'Guardar cambios' : 'Está bien: confirmar'}
        </Boton>
        <Boton variante="fantasma" cargando={descartar.isPending} onClick={() => descartar.mutate(gasto.id)}>
          <Trash2 aria-hidden />
          Descartar
        </Boton>
      </div>
    </form>
  );
}
