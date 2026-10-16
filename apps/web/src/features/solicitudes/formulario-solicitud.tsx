import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiError } from '@viaticos/client-api';
import { destinosOptions, tasasDelDiaOptions, useApi, useCrearSolicitud, useEstimado } from '@viaticos/client-app';
import { crearSolicitudRequestSchema, estimarViajeRequestSchema, type EstimarViajeRequest } from '@viaticos/contracts';
import { useMemo } from 'react';
import { useFieldArray, useForm, useWatch, type Path } from 'react-hook-form';
import type { z } from 'zod';
import { mensajeDeError } from '../../lib/errores';
import { nombrePais } from '../../lib/formato';
import { useValorDiferido } from '../../lib/use-valor-diferido';
import { Boton } from '../../ui/boton';
import { AreaTexto, Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';
import { AvisoEscalamiento, TablaPresupuesto, TasasDelDia } from './componentes';

type Entrada = z.input<typeof crearSolicitudRequestSchema>;
type Salida = z.output<typeof crearSolicitudRequestSchema>;

const destinoVacio = (fechaInicio = ''): Entrada['destinos'][number] => ({
  paisCodigo: '',
  ciudad: '',
  fechaInicio,
  fechaFin: '',
  valoresSolicitados: [],
});

export function FormularioSolicitud() {
  const api = useApi();
  const navigate = useNavigate();
  const paises = useQuery(destinosOptions(api));
  const tasas = useQuery(tasasDelDiaOptions(api));
  const crear = useCrearSolicitud();

  const form = useForm<Entrada, unknown, Salida>({
    resolver: zodResolver(crearSolicitudRequestSchema),
    defaultValues: { monedaAnticipo: 'USD', motivo: '', justificacion: '', destinos: [destinoVacio()] },
    mode: 'onTouched',
  });
  const { register, control, formState, setValue, getValues, setError } = form;
  const errores = formState.errors;
  const { fields, append, remove } = useFieldArray({ control, name: 'destinos' });

  // Estimado en vivo: se consulta cuando la parte del viaje es válida y el usuario deja de escribir.
  const monedaAnticipo = useWatch({ control, name: 'monedaAnticipo' });
  const destinos = useWatch({ control, name: 'destinos' });
  const borrador = useValorDiferido(JSON.stringify({ monedaAnticipo, destinos }), 400);
  const peticion = useMemo<EstimarViajeRequest | null>(() => {
    const datos = JSON.parse(borrador) as EstimarViajeRequest;
    return estimarViajeRequestSchema.safeParse(datos).success ? datos : null;
  }, [borrador]);
  const estimado = useEstimado(peticion);
  const escala = estimado.data?.escalamiento.requiereJefeDirectivo ?? false;
  const destinosEstimados = peticion?.destinos ?? [];

  const proponer = (i: number, conceptoCodigo: string, valor: string | null) => {
    const actuales = (getValues(`destinos.${i}.valoresSolicitados`) ?? []).filter((v) => v.conceptoCodigo !== conceptoCodigo);
    setValue(`destinos.${i}.valoresSolicitados`, valor === null ? actuales : [...actuales, { conceptoCodigo, valorUnitario: valor }], {
      shouldDirty: true,
    });
  };

  const enviar = form.handleSubmit(async (datos) => {
    if (escala && !datos.justificacion) {
      setError('justificacion', { message: 'error.JUSTIFICACION_REQUERIDA' }, { shouldFocus: true });
      return;
    }
    try {
      const solicitud = await crear.mutateAsync(datos);
      await navigate({ to: '/solicitudes/$solicitudId', params: { solicitudId: solicitud.id } });
    } catch (error) {
      if (!(error instanceof ApiError)) return;
      for (const [ruta, claves] of Object.entries(error.erroresCampo)) {
        setError(ruta as Path<Entrada>, { message: claves[0] });
      }
      if (error.codigo === 'JUSTIFICACION_REQUERIDA') setError('justificacion', { message: 'error.JUSTIFICACION_REQUERIDA' });
    }
  });

  return (
    <form noValidate onSubmit={enviar} className="space-y-5">
      <Tarjeta className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">Viaje</h2>
          <Campo etiqueta="Moneda del anticipo" className="w-40">
            {(a11y) => (
              <Seleccion {...a11y} {...register('monedaAnticipo')}>
                <option value="USD">USD – Dólares</option>
                <option value="COP">COP – Pesos</option>
              </Seleccion>
            )}
          </Campo>
        </div>
        <TasasDelDia tasas={tasas.data} />

        {fields.map((campo, i) => {
          const e = errores.destinos?.[i];
          return (
            <fieldset key={campo.id} className="rounded-lg border border-slate-200 p-3 sm:p-4">
              <legend className="px-1 text-sm font-semibold text-slate-700">Destino {i + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Campo etiqueta="País" error={e?.paisCodigo?.message}>
                  {(a11y) => (
                    <Seleccion {...a11y} {...register(`destinos.${i}.paisCodigo`)} error={e?.paisCodigo?.message}>
                      <option value="">{paises.isLoading ? 'Cargando…' : 'Seleccione'}</option>
                      {paises.data?.map((p) => (
                        <option key={p} value={p}>
                          {nombrePais(p)}
                        </option>
                      ))}
                    </Seleccion>
                  )}
                </Campo>
                <Campo etiqueta="Ciudad" error={e?.ciudad?.message}>
                  {(a11y) => <Entrada {...a11y} {...register(`destinos.${i}.ciudad`)} error={e?.ciudad?.message} />}
                </Campo>
                <Campo etiqueta="Salida" error={e?.fechaInicio?.message}>
                  {(a11y) => (
                    <Entrada {...a11y} type="date" {...register(`destinos.${i}.fechaInicio`)} error={e?.fechaInicio?.message} />
                  )}
                </Campo>
                <Campo etiqueta="Regreso / fin" error={e?.fechaFin?.message}>
                  {(a11y) => <Entrada {...a11y} type="date" {...register(`destinos.${i}.fechaFin`)} error={e?.fechaFin?.message} />}
                </Campo>
              </div>
              {fields.length > 1 && (
                <Boton variante="fantasma" className="mt-2 text-red-700" onClick={() => remove(i)}>
                  Quitar destino
                </Boton>
              )}
            </fieldset>
          );
        })}
        {errores.destinos?.root?.message && <Alerta tono="peligro">{errores.destinos.root.message}</Alerta>}
        <Boton variante="secundario" onClick={() => append(destinoVacio(destinos.at(-1)?.fechaFin ?? ''))}>
          + Agregar destino
        </Boton>
      </Tarjeta>

      <Tarjeta className="space-y-4" aria-live="polite">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Estimado</h2>
          {estimado.isFetching && <span className="text-sm text-slate-500">Calculando…</span>}
        </div>
        {!peticion && <p className="text-sm text-slate-600">Complete país, ciudad y fechas para ver el presupuesto según su cargo.</p>}
        {peticion && estimado.isError && <Alerta tono="peligro">{mensajeDeError(estimado.error)}</Alerta>}
        {peticion && estimado.data && (
          <>
            <p className="text-sm text-slate-600">
              Puede ajustar el valor por noche o por día. Si supera la tarifa de su cargo, la solicitud irá también al jefe directivo.
            </p>
            <TablaPresupuesto presupuesto={estimado.data.presupuesto} destinos={destinosEstimados} alProponer={proponer} />
            <AvisoEscalamiento escalamiento={estimado.data.escalamiento} />
          </>
        )}
      </Tarjeta>

      <Tarjeta className="space-y-4">
        <h2 className="text-lg font-semibold">Motivo</h2>
        <Campo etiqueta="¿Para qué es el viaje?" error={errores.motivo?.message}>
          {(a11y) => <AreaTexto {...a11y} {...register('motivo')} error={errores.motivo?.message} />}
        </Campo>
        {escala && (
          <Campo
            etiqueta="Justificación para el jefe directivo"
            error={errores.justificacion?.message}
            ayuda="Explique por qué el viaje necesita valores por encima de la política."
          >
            {(a11y) => <AreaTexto {...a11y} {...register('justificacion')} error={errores.justificacion?.message} />}
          </Campo>
        )}
      </Tarjeta>

      {crear.isError && !(crear.error instanceof ApiError && Object.keys(crear.error.erroresCampo).length) && (
        <Alerta tono="peligro">{mensajeDeError(crear.error)}</Alerta>
      )}

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Boton variante="secundario" onClick={() => navigate({ to: '/solicitudes' })}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={crear.isPending} disabled={!estimado.data}>
          Enviar a aprobación
        </Boton>
      </div>
    </form>
  );
}
