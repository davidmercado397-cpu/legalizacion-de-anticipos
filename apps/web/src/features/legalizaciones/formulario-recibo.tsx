import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { politicaLegalizacionOptions, useAgregarReciboCaja, useApi } from '@viaticos/client-app';
import { categoriaGastoSchema, medioPagoSchema, reciboCajaRequestSchema, type ReciboCajaRequest } from '@viaticos/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { t } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { hoyLocal } from '../../lib/fechas';
import { formatoDinero } from '../../lib/formato';
import { prepararArchivo } from '../../lib/preparar-imagen';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';

/** Compra sin factura (taxi informal, vendedor ambulante…): recibo de caja con tercero 222. */
export function FormularioReciboCaja({ legalizacionId, moneda, alTerminar }: { legalizacionId: string; moneda: string; alTerminar: () => void }) {
  const api = useApi();
  const politica = useQuery(politicaLegalizacionOptions(api));
  const agregar = useAgregarReciboCaja();
  const [foto, setFoto] = useState<File | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ReciboCajaRequest>({
    resolver: zodResolver(reciboCajaRequestSchema),
    defaultValues: { fecha: hoyLocal(), moneda, valor: '', categoria: 'TRANSPORTE', medioPago: 'EFECTIVO', paisCodigo: '', descripcion: '', beneficiario: '' },
  });

  const enviar = handleSubmit(async (datos) => {
    const archivo = foto ? await prepararArchivo(foto) : null;
    agregar.mutate({ id: legalizacionId, datos, archivo }, { onSuccess: alTerminar });
  });

  return (
    <Tarjeta className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Recibo de caja (compra sin factura)</h2>
        <p className="text-sm text-slate-600">
          Se legaliza a nombre de <strong>proveedores varios (tercero 222)</strong>, no a su nombre.
          {politica.data && (
            <> Tope por recibo: {politica.data.topesReciboCaja.map((tope) => formatoDinero(tope)).join(' o ')}.</>
          )}
        </p>
      </div>
      <form noValidate onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="¿Qué compró?" error={errors.descripcion?.message} className="sm:col-span-2">
          {(a11y) => <Entrada {...a11y} placeholder="Taxi informal del aeropuerto al hotel" {...register('descripcion')} error={errors.descripcion?.message} />}
        </Campo>
        <Campo etiqueta="Fecha" error={errors.fecha?.message}>
          {(a11y) => <Entrada {...a11y} type="date" max={hoyLocal()} {...register('fecha')} error={errors.fecha?.message} />}
        </Campo>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Campo etiqueta="Valor" error={errors.valor?.message}>
            {(a11y) => <Entrada {...a11y} inputMode="decimal" {...register('valor')} error={errors.valor?.message} />}
          </Campo>
          <Campo etiqueta="Moneda" error={errors.moneda?.message}>
            {(a11y) => <Entrada {...a11y} maxLength={3} className="uppercase" {...register('moneda')} error={errors.moneda?.message} />}
          </Campo>
        </div>
        <Campo etiqueta="Categoría">
          {(a11y) => (
            <Seleccion {...a11y} {...register('categoria')}>
              {categoriaGastoSchema.options.map((c) => (
                <option key={c} value={c}>
                  {t(`categoria.${c}`)}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Medio de pago">
          {(a11y) => (
            <Seleccion {...a11y} {...register('medioPago')}>
              {medioPagoSchema.options.map((m) => (
                <option key={m} value={m}>
                  {t(`medioPago.${m}`)}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="País (código)" error={errors.paisCodigo?.message} ayuda="CO, BR, US…">
          {(a11y) => <Entrada {...a11y} maxLength={2} className="uppercase" {...register('paisCodigo')} error={errors.paisCodigo?.message} />}
        </Campo>
        <Campo etiqueta="A quién le compró (opcional)">
          {(a11y) => <Entrada {...a11y} {...register('beneficiario')} />}
        </Campo>
        <Campo etiqueta="Foto del recibo firmado (opcional)" className="sm:col-span-2">
          {(a11y) => <input {...a11y} type="file" accept="image/*,application/pdf" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} className="text-sm" />}
        </Campo>
        {agregar.isError && (
          <div className="sm:col-span-2">
            <Alerta tono="peligro">{mensajeDeError(agregar.error)}</Alerta>
          </div>
        )}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Boton variante="secundario" onClick={alTerminar}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={agregar.isPending}>
            Agregar recibo
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
