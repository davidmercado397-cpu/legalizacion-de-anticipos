import { zodResolver } from '@hookform/resolvers/zod';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { escalamientoOptions, useApi, useGuardarEscalamiento } from '@viaticos/client-app';
import { configuracionEscalamientoSchema, type ConfiguracionEscalamientoRequest } from '@viaticos/contracts';
import { useForm, useWatch } from 'react-hook-form';
import { mensajeDeError } from '../../../lib/errores';
import { formatoMomento } from '../../../lib/formato';
import { exigirRol } from '../../../lib/roles';
import { Boton } from '../../../ui/boton';
import { Campo, Entrada } from '../../../ui/campos';
import { Alerta, Cargando, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/contabilidad/escalamiento')({
  beforeLoad: ({ context }) => exigirRol(context.sesion, 'CONTABILIDAD'),
  loader: ({ context }) => context.queryClient.ensureQueryData(escalamientoOptions(context.api)),
  pendingComponent: () => <Cargando />,
  component: Escalamiento,
});

function Escalamiento() {
  const api = useApi();
  const { data } = useSuspenseQuery(escalamientoOptions(api));
  const guardar = useGuardarEscalamiento();
  const { register, handleSubmit, control, formState } = useForm<ConfiguracionEscalamientoRequest>({
    resolver: zodResolver(configuracionEscalamientoSchema),
    defaultValues: { excedeTarifa: data.excedeTarifa, montoTotal: data.montoTotal },
  });
  const tolerancia = Number(useWatch({ control, name: 'excedeTarifa.toleranciaPorcentaje' })) || 0;
  const e = formState.errors;

  return (
    <form noValidate onSubmit={handleSubmit((d) => guardar.mutate(d))} className="space-y-5">
      <Link to="/contabilidad/configuracion" className="text-sm text-marca-700 hover:underline">
        ← Configuración
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Reglas de aprobación</h1>
        <p className="text-sm text-slate-600">Una solicitud necesita además la aprobación del jefe directivo cuando se cumple alguna de estas reglas.</p>
        {data.actualizadoEn && (
          <p className="text-xs text-slate-500">
            Última actualización: {formatoMomento(data.actualizadoEn)} · {data.actualizadoPorNombre}
          </p>
        )}
      </div>

      <Tarjeta className="space-y-3">
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" className="size-4" {...register('excedeTarifa.activa')} /> Un concepto supera su tarifa
        </label>
        <Campo
          etiqueta="Tolerancia sobre la tarifa (%)"
          error={e.excedeTarifa?.toleranciaPorcentaje?.message}
          ayuda={`Ejemplo: con tarifa de hotel de 30 USD, escala si se pide más de ${(30 * (1 + tolerancia / 100)).toLocaleString('es-CO', { maximumFractionDigits: 2 })} USD por noche.`}
          className="max-w-xs"
        >
          {(a11y) => <Entrada {...a11y} inputMode="decimal" {...register('excedeTarifa.toleranciaPorcentaje')} />}
        </Campo>
      </Tarjeta>

      <Tarjeta className="space-y-3">
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" className="size-4" {...register('montoTotal.activa')} /> El anticipo total supera un monto
        </label>
        <div className="grid max-w-md gap-3 sm:grid-cols-2">
          <Campo etiqueta="Umbral en USD" error={e.montoTotal?.umbralUsd?.message}>
            {(a11y) => <Entrada {...a11y} inputMode="decimal" {...register('montoTotal.umbralUsd')} />}
          </Campo>
          <Campo etiqueta="Umbral en COP" error={e.montoTotal?.umbralCop?.message}>
            {(a11y) => <Entrada {...a11y} inputMode="decimal" {...register('montoTotal.umbralCop')} />}
          </Campo>
        </div>
      </Tarjeta>

      {guardar.isSuccess && <Alerta tono="exito">Reglas guardadas. Aplican a las solicitudes nuevas.</Alerta>}
      {guardar.error && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
      <div className="flex justify-end">
        <Boton type="submit" cargando={guardar.isPending}>
          Guardar
        </Boton>
      </div>
    </form>
  );
}
