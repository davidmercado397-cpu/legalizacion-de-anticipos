import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { ApiError } from '@viaticos/client-api';
import { useCategorias, useCompanias, usePresupuesto, useSesion, useSolicitarAnticipo } from '@viaticos/client-app';
import type { Anticipo, Presupuesto } from '@viaticos/contracts';
import { useEffect } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero } from '../../lib/formato';
import { opcionesDeMoneda } from '../../lib/monedas';
import { Boton } from '../../ui/boton';
import { AreaTexto, Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';
import { sinRechazo } from '../../lib/sin-rechazo';

const decimal = /^\d+([.,]\d{1,2})?$/;

const tramo = z
  .object({
    destination: z.string().trim().min(2, 'validation.required'),
    start_date: z.string().min(1, 'validation.date'),
    end_date: z.string().min(1, 'validation.date'),
  })
  .refine((d) => !d.start_date || !d.end_date || d.end_date >= d.start_date, { path: ['end_date'], message: 'validation.endBeforeStart' });

const esquema = z.object({
  company_id: z.string().min(1, 'validation.required'),
  kind: z.enum(['cash', 'reloadable_card', 'corporate_card']),
  currency: z.string().length(3, 'validation.required'),
  destinos: z.array(tramo).min(1).max(10),
  purpose: z.string().trim().min(3, 'validation.minLength'),
  amount: z.string().trim().refine((v) => v === '' || decimal.test(v), 'validation.decimal'),
  justification: z.string().trim(),
});

type Datos = z.infer<typeof esquema>;
type Tramo = Datos['destinos'][number];

const TRAMO_VACIO: Tramo = { destination: '', start_date: '', end_date: '' };

/** Un destino viaja como antes; varios van como tramos (el día de traslado lo paga la ciudad de llegada). */
function viaje(destinos: Tramo[]) {
  if (destinos.length === 1) {
    const [d] = destinos as [Tramo];
    return { destination: d.destination || null, start_date: d.start_date, end_date: d.end_date };
  }
  return { legs: destinos };
}

/** El presupuesto sale de las tarifas de viaje; pedir otro valor exige justificación (lo valida la API). */
export function FormularioSolicitud({ alCrear }: { alCrear: (anticipo: Anticipo) => void }) {
  const usuario = useSesion((s) => s.usuario);
  const companias = useCompanias();
  const presupuesto = usePresupuesto();
  const solicitar = useSolicitarAnticipo();
  const navegar = useNavigate();
  const propias = (companias.data ?? []).filter((c) => usuario?.company_ids.includes(c.id));

  const { register, handleSubmit, formState, control, setValue } = useForm<Datos>({
    resolver: zodResolver(esquema),
    defaultValues: {
      kind: 'cash',
      currency: 'COP',
      amount: '',
      justification: '',
      company_id: usuario?.company_ids[0] ?? '',
      destinos: [TRAMO_VACIO],
    },
  });
  const tramos = useFieldArray({ control, name: 'destinos' });
  const [compania, destinos, moneda, valor] = useWatch({ control, name: ['company_id', 'destinos', 'currency', 'amount'] });
  const proposito = useWatch({ control, name: 'purpose' });
  // Lo que la persona escribió (la compañía y la moneda las pone el formulario): solo eso pide confirmar al cancelar.
  const conCambios =
    destinos.length > 1 || destinos.some((d) => d.destination || d.start_date || d.end_date) || !!proposito?.trim() || !!valor.trim();
  const fechasCompletas = destinos.every((d) => d.start_date && d.end_date);
  const categorias = useCategorias(compania);
  const categoria = (codigo: string) => categorias.data?.find((c) => c.code === codigo)?.name ?? codigo;

  // La moneda por defecto es la de la compañía.
  useEffect(() => {
    const encontrada = propias.find((c) => c.id === compania);
    if (encontrada) setValue('currency', encontrada.currency);
  }, [compania, propias.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const calculado: Presupuesto | undefined = presupuesto.data;
  // La moneda del anticipo es la de las tarifas del destino; si se mezclan, dólares (decisión 4.8).
  useEffect(() => {
    if (calculado) setValue('currency', calculado.currency);
  }, [calculado]); // eslint-disable-line react-hooks/exhaustive-deps
  const distinto = !!calculado && valor !== '' && Number(valor.replace(',', '.')) !== Number(calculado.total);
  // Si escala al jefe directivo (decisión 4.3) la API pide justificación aunque el valor sea el sugerido.
  const escala = solicitar.error instanceof ApiError && solicitar.error.codigo === 'escalation_justification_required';

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={handleSubmit(sinRechazo(async (d) => {
        const anticipo = await solicitar.mutateAsync({
          company_id: d.company_id,
          kind: d.kind,
          currency: d.currency,
          purpose: d.purpose,
          ...viaje(d.destinos),
          amount: d.amount === '' ? null : d.amount.replace(',', '.'),
          justification: d.justification || null,
        });
        alCrear(anticipo);
      }))}
    >
      <Tarjeta className="grid gap-4 sm:grid-cols-2">
        {propias.length > 1 && (
          <Campo etiqueta="Compañía" error={formState.errors.company_id?.message} className="sm:col-span-2">
            {(p) => (
              <Seleccion {...p} {...register('company_id')}>
                {propias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Seleccion>
            )}
          </Campo>
        )}
        {tramos.fields.map((campo, i) => {
          const errores = formState.errors.destinos?.[i];
          const varios = tramos.fields.length > 1;
          return (
            <fieldset key={campo.id} className="grid gap-4 sm:col-span-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-start">
              <Campo etiqueta={varios ? `Destino ${i + 1}` : 'Destino'} error={errores?.destination?.message} ayuda="Ciudad o país">
                {(p) => <Entrada {...p} {...register(`destinos.${i}.destination`)} placeholder="Ej. Medellín" />}
              </Campo>
              <Campo etiqueta={varios ? 'Llega' : 'Salida'} error={errores?.start_date?.message}>
                {(p) => <Entrada {...p} {...register(`destinos.${i}.start_date`)} type="date" />}
              </Campo>
              <Campo etiqueta={varios ? 'Sale' : 'Regreso'} error={errores?.end_date?.message}>
                {(p) => <Entrada {...p} {...register(`destinos.${i}.end_date`)} type="date" />}
              </Campo>
              {varios && (
                <Boton variante="fantasma" className="sm:mt-6" onClick={() => tramos.remove(i)} aria-label={`Quitar el destino ${i + 1}`}>
                  Quitar
                </Boton>
              )}
            </fieldset>
          );
        })}
        {tramos.fields.length < 10 && (
          <div className="sm:col-span-2">
            <Boton
              variante="secundario"
              onClick={() => tramos.append({ ...TRAMO_VACIO, start_date: destinos.at(-1)?.end_date ?? '' })}
            >
              Agregar otro destino
            </Boton>
            {tramos.fields.length > 1 && (
              <p className="mt-1 text-xs text-slate-500">El día en que cambia de ciudad se paga una sola vez, con la tarifa de la ciudad a la que llega.</p>
            )}
          </div>
        )}
        <Campo etiqueta="Motivo del viaje" error={formState.errors.purpose?.message} className="sm:col-span-2">
          {(p) => <AreaTexto {...p} {...register('purpose')} />}
        </Campo>
        <Campo etiqueta="Cómo recibe el dinero" error={formState.errors.kind?.message}>
          {(p) => (
            <Seleccion {...p} {...register('kind')}>
              {(['cash', 'reloadable_card', 'corporate_card'] as const).map((k) => (
                <option key={k} value={k}>
                  {etiqueta('tipo', k)}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Moneda" error={formState.errors.currency?.message}>
          {(p) => (
            <Seleccion {...p} {...register('currency')}>
              {opcionesDeMoneda(usuario, moneda).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
      </Tarjeta>

      <Tarjeta className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Presupuesto</h2>
          <Boton
            variante="secundario"
            cargando={presupuesto.isPending}
            disabled={!compania || !fechasCompletas}
            onClick={() => presupuesto.mutate({ company_id: compania, ...viaje(destinos) })}
          >
            Calcular con las tarifas
          </Boton>
        </div>
        {presupuesto.isError && <Alerta tono="aviso">{mensajeDeError(presupuesto.error)} Escribe el valor que necesitas.</Alerta>}
        {calculado && (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {calculado.lines.map((l) => (
                <tr key={`${l.destination ?? ''}-${l.category}-${l.unit}`}>
                  <td className="py-1.5">
                    {categoria(l.category)}
                    {l.destination && <span className="text-slate-500"> · {l.destination}</span>}
                  </td>
                  <td className="py-1.5 text-slate-500">
                    {l.units} × {formatoDinero(l.rate, calculado.currency)}
                  </td>
                  <td className="py-1.5 text-right">{formatoDinero(l.amount, calculado.currency)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1.5" colSpan={2}>
                  Total sugerido
                </td>
                <td className="py-1.5 text-right">{formatoDinero(calculado.total, calculado.currency)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <Campo
          etiqueta={`Valor que solicita (${moneda || '—'})`}
          error={formState.errors.amount?.message}
          ayuda={calculado ? 'Vacío = el total sugerido' : undefined}
        >
          {(p) => <Entrada {...p} {...register('amount')} inputMode="decimal" />}
        </Campo>
        {(distinto || escala) && (
          <Campo
            etiqueta={escala ? '¿Por qué necesitas este valor? (también lo aprobará el jefe directivo)' : '¿Por qué necesitas un valor distinto al sugerido?'}
            error={formState.errors.justification?.message}
          >
            {(p) => <AreaTexto {...p} {...register('justification')} />}
          </Campo>
        )}
      </Tarjeta>

      {solicitar.isError && <Alerta tono="peligro">{mensajeDeError(solicitar.error)}</Alerta>}
      <div className="flex flex-wrap gap-2">
        <Boton type="submit" cargando={solicitar.isPending}>
          Enviar a aprobación
        </Boton>
        <Boton
          variante="secundario"
          onClick={() => {
            if (!conCambios || window.confirm('¿Cancelar la solicitud? Lo que escribió no se guarda.')) void navegar({ to: '/anticipos' });
          }}
        >
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
