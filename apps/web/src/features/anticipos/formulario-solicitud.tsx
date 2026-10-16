import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@viaticos/client-api';
import { useCompanias, usePresupuesto, useSesion, useSolicitarAnticipo } from '@viaticos/client-app';
import type { Anticipo, Presupuesto } from '@viaticos/contracts';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { AreaTexto, Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';
import { sinRechazo } from '../../lib/sin-rechazo';

const decimal = /^\d+([.,]\d{1,2})?$/;

const esquema = z
  .object({
    company_id: z.string().min(1, 'validation.required'),
    kind: z.enum(['cash', 'reloadable_card', 'corporate_card']),
    currency: z.string().length(3, 'validation.required'),
    destination: z.string().trim().min(2, 'validation.required'),
    start_date: z.string().min(1, 'validation.date'),
    end_date: z.string().min(1, 'validation.date'),
    purpose: z.string().trim().min(3, 'validation.minLength'),
    amount: z.string().trim().refine((v) => v === '' || decimal.test(v), 'validation.decimal'),
    justification: z.string().trim(),
  })
  .refine((d) => !d.start_date || !d.end_date || d.end_date >= d.start_date, { path: ['end_date'], message: 'validation.endBeforeStart' });

type Datos = z.infer<typeof esquema>;

/** El presupuesto sale de las tarifas de viaje; pedir otro valor exige justificación (lo valida la API). */
export function FormularioSolicitud({ alCrear }: { alCrear: (anticipo: Anticipo) => void }) {
  const usuario = useSesion((s) => s.usuario);
  const companias = useCompanias();
  const presupuesto = usePresupuesto();
  const solicitar = useSolicitarAnticipo();
  const propias = (companias.data ?? []).filter((c) => usuario?.company_ids.includes(c.id));

  const { register, handleSubmit, formState, control, setValue } = useForm<Datos>({
    resolver: zodResolver(esquema),
    defaultValues: { kind: 'cash', currency: 'COP', amount: '', justification: '', company_id: usuario?.company_ids[0] ?? '' },
  });
  const [compania, destino, inicio, fin, moneda, valor] = useWatch({
    control,
    name: ['company_id', 'destination', 'start_date', 'end_date', 'currency', 'amount'],
  });

  // La moneda por defecto es la de la compañía.
  useEffect(() => {
    const encontrada = propias.find((c) => c.id === compania);
    if (encontrada) setValue('currency', encontrada.currency);
  }, [compania, propias.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const calculado: Presupuesto | undefined = presupuesto.data;
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
          destination: d.destination,
          start_date: d.start_date,
          end_date: d.end_date,
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
        <Campo etiqueta="Destino" error={formState.errors.destination?.message} ayuda="Ciudad o país" className="sm:col-span-2">
          {(p) => <Entrada {...p} {...register('destination')} placeholder="Ej. Medellín" />}
        </Campo>
        <Campo etiqueta="Salida" error={formState.errors.start_date?.message}>
          {(p) => <Entrada {...p} {...register('start_date')} type="date" />}
        </Campo>
        <Campo etiqueta="Regreso" error={formState.errors.end_date?.message}>
          {(p) => <Entrada {...p} {...register('end_date')} type="date" />}
        </Campo>
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
          {(p) => <Entrada {...p} {...register('currency')} maxLength={3} className="uppercase" />}
        </Campo>
      </Tarjeta>

      <Tarjeta className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Presupuesto</h2>
          <Boton
            variante="secundario"
            cargando={presupuesto.isPending}
            disabled={!compania || !inicio || !fin}
            onClick={() => presupuesto.mutate({ company_id: compania, destination: destino || null, start_date: inicio, end_date: fin })}
          >
            Calcular con las tarifas
          </Boton>
        </div>
        {presupuesto.isError && <Alerta tono="aviso">{mensajeDeError(presupuesto.error)} Escriba el valor que necesita.</Alerta>}
        {calculado && (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {calculado.lines.map((l) => (
                <tr key={`${l.category}-${l.unit}`}>
                  <td className="py-1.5">{l.category}</td>
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
            etiqueta={escala ? '¿Por qué necesita este valor? (también lo aprobará el jefe directivo)' : '¿Por qué necesita un valor distinto al sugerido?'}
            error={formState.errors.justification?.message}
          >
            {(p) => <AreaTexto {...p} {...register('justification')} />}
          </Campo>
        )}
      </Tarjeta>

      {solicitar.isError && <Alerta tono="peligro">{mensajeDeError(solicitar.error)}</Alerta>}
      <Boton type="submit" cargando={solicitar.isPending}>
        Enviar a aprobación
      </Boton>
    </form>
  );
}
