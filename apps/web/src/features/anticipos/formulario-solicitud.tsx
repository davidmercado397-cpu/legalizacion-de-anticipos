import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useCategorias, useCompanias, usePresupuesto, useSesion, useSolicitarAnticipo } from '@viaticos/client-app';
import type { Anticipo, Presupuesto } from '@viaticos/contracts';
import { Calculator, Plus, Send, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { etiqueta } from '../../i18n';
import { codigoDeError, mensajeDeError } from '../../lib/errores';
import { formatoDinero } from '../../lib/formato';
import { opcionesDeMoneda } from '../../lib/monedas';
import { Boton } from '../../ui/boton';
import { AreaTexto, Campo, Entrada, Grupo, Seleccion } from '../../ui/campos';
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
  const escala = codigoDeError(solicitar.error) === 'escalation_justification_required';

  return (
    <form
      noValidate
      className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem]"
      onSubmit={handleSubmit(
        sinRechazo(async (d) => {
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
        }),
      )}
    >
      <div className="min-w-0 space-y-10">
        <Grupo titulo="El viaje">
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
                <legend className="sr-only">{`Destino ${i + 1}`}</legend>
                <Campo etiqueta={varios ? `Destino ${i + 1}` : 'Destino'} error={errores?.destination?.message} ayuda="Ciudad o país">
                  {(p) => <Entrada {...p} {...register(`destinos.${i}.destination`)} placeholder="Por ejemplo Medellín" />}
                </Campo>
                <Campo etiqueta={varios ? 'Llegas' : 'Salida'} error={errores?.start_date?.message}>
                  {(p) => <Entrada {...p} {...register(`destinos.${i}.start_date`)} type="date" />}
                </Campo>
                <Campo etiqueta={varios ? 'Sales' : 'Regreso'} error={errores?.end_date?.message}>
                  {(p) => <Entrada {...p} {...register(`destinos.${i}.end_date`)} type="date" />}
                </Campo>
                {varios && (
                  <Boton variante="fantasma" className="px-3 sm:mt-6" onClick={() => tramos.remove(i)} aria-label={`Quitar el destino ${i + 1}`}>
                    <Trash2 aria-hidden />
                  </Boton>
                )}
              </fieldset>
            );
          })}
          {tramos.fields.length < 10 && (
            <div className="space-y-1 sm:col-span-2">
              <Boton
                variante="secundario"
                tamano="pequeno"
                onClick={() => tramos.append({ ...TRAMO_VACIO, start_date: destinos.at(-1)?.end_date ?? '' })}
              >
                <Plus aria-hidden />
                Agregar otro destino
              </Boton>
              {tramos.fields.length > 1 && (
                <p className="text-sm text-slate-500">El día en que cambias de ciudad se paga una sola vez, con la tarifa de la ciudad a la que llegas.</p>
              )}
            </div>
          )}
          <Campo etiqueta="Motivo del viaje" error={formState.errors.purpose?.message} className="sm:col-span-2">
            {(p) => <AreaTexto {...p} {...register('purpose')} />}
          </Campo>
        </Grupo>

        <Grupo titulo="La entrega">
          <Campo etiqueta="Cómo recibes el dinero" error={formState.errors.kind?.message}>
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
        </Grupo>
      </div>

      {/* El presupuesto acompaña el formulario: se calcula, se ajusta y desde ahí se envía. */}
      <Tarjeta className="space-y-5 self-start lg:sticky lg:top-8">
        <div className="space-y-1">
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Presupuesto</h2>
          <p className="text-sm text-slate-600">Sale de las tarifas de viaje de tu compañía para cada destino.</p>
        </div>
        <Boton
          variante="secundario"
          className="w-full"
          cargando={presupuesto.isPending}
          disabled={!compania || !fechasCompletas}
          onClick={() => presupuesto.mutate({ company_id: compania, ...viaje(destinos) })}
        >
          <Calculator aria-hidden />
          Calcular con las tarifas
        </Boton>
        {!fechasCompletas && !calculado && <p className="text-sm text-slate-500">Escribe las fechas del viaje para calcularlo.</p>}
        {presupuesto.isError && <Alerta tono="aviso">{mensajeDeError(presupuesto.error)} Escribe el valor que necesitas.</Alerta>}
        {calculado && (
          <dl className="space-y-2 text-sm">
            {calculado.lines.map((l) => (
              <div key={`${l.destination ?? ''}-${l.category}-${l.unit}`} className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0">
                  {categoria(l.category)}
                  {l.destination && <span className="text-slate-500"> · {l.destination}</span>}
                  <span className="block text-xs text-slate-500 tabular-nums">
                    {l.units} × {formatoDinero(l.rate, calculado.currency)}
                  </span>
                </dt>
                <dd className="tabular-nums">{formatoDinero(l.amount, calculado.currency)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-2 font-bold text-slate-900">
              <dt>Total sugerido</dt>
              <dd className="tabular-nums">{formatoDinero(calculado.total, calculado.currency)}</dd>
            </div>
          </dl>
        )}
        <Campo
          etiqueta={`Valor que pides (${moneda || '—'})`}
          error={formState.errors.amount?.message}
          ayuda={calculado ? 'Vacío = el total sugerido' : undefined}
        >
          {(p) => <Entrada {...p} {...register('amount')} inputMode="decimal" className="text-right tabular-nums" />}
        </Campo>
        {(distinto || escala) && (
          <Campo
            etiqueta={escala ? '¿Por qué necesitas este valor? (también lo aprobará el jefe directivo)' : '¿Por qué necesitas un valor distinto al sugerido?'}
            error={formState.errors.justification?.message}
          >
            {(p) => <AreaTexto {...p} {...register('justification')} />}
          </Campo>
        )}
        {solicitar.isError && <Alerta tono="peligro">{mensajeDeError(solicitar.error)}</Alerta>}
        <div className="space-y-2">
          <Boton type="submit" className="w-full" cargando={solicitar.isPending}>
            <Send aria-hidden />
            Enviar a aprobación
          </Boton>
          <Boton
            variante="fantasma"
            className="w-full"
            onClick={() => {
              if (!conCambios || window.confirm('¿Cancelar la solicitud? Lo que escribiste no se guarda.')) void navegar({ to: '/anticipos' });
            }}
          >
            Cancelar
          </Boton>
        </div>
      </Tarjeta>
    </form>
  );
}
