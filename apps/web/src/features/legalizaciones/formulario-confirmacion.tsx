import { zodResolver } from '@hookform/resolvers/zod';
import { useConfirmarSoporte } from '@viaticos/client-app';
import { ApiError } from '@viaticos/client-api';
import {
  categoriaGastoSchema,
  confirmarSoporteRequestSchema,
  medioPagoSchema,
  type ConfirmarSoporteRequest,
  type LegalizacionResponse,
  type SoporteResponse,
} from '@viaticos/contracts';
import { useFieldArray, useForm, useWatch, type Path } from 'react-hook-form';
import type { z } from 'zod';
import { t } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { hoyLocal } from '../../lib/fechas';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Insignia, Tarjeta } from '../../ui/superficies';

/** Valores iniciales: lo ya confirmado, o lo que leyó el OCR, o vacío. */
function valoresIniciales(s: SoporteResponse, monedaAnticipo: string): ConfirmarSoporteRequest {
  if (s.datos) {
    return {
      ...s.datos,
      moneda: s.datos.total.moneda,
      total: s.datos.total.monto,
      lineas: s.datos.lineas.map((l) => ({ descripcion: l.descripcion, valor: l.valor.monto })),
      propinaSugerida: s.datos.propinaSugerida?.monto ?? '',
    };
  }
  const e = s.extraccion;
  return {
    emisorNombre: e?.emisorNombre ?? '',
    emisorId: e?.emisorId ?? '',
    adquirienteId: e?.adquirienteId ?? '',
    numeroDocumento: e?.numeroDocumento ?? '',
    fecha: e?.fecha ?? '',
    moneda: e?.moneda ?? monedaAnticipo,
    total: e?.total ?? '',
    claveFiscal: e?.claveFiscal ?? null,
    medioPago: e?.medioPago ?? 'DESCONOCIDO',
    ultimos4Tarjeta: e?.ultimos4Tarjeta ?? '',
    paisCodigo: e?.paisCodigo ?? '',
    categoria: e?.categoriaSugerida ?? 'OTROS',
    lineas: e?.lineas ?? [],
    propinaSugerida: e?.propinaSugerida ?? '',
  };
}

export function FormularioConfirmacion({
  legalizacion,
  soporte,
  nitEmpresa,
  alConfirmar,
}: {
  legalizacion: LegalizacionResponse;
  soporte: SoporteResponse;
  nitEmpresa?: string | undefined;
  alConfirmar: () => void;
}) {
  const confirmar = useConfirmarSoporte();
  const form = useForm<ConfirmarSoporteRequest, unknown, z.output<typeof confirmarSoporteRequestSchema>>({
    resolver: zodResolver(confirmarSoporteRequestSchema),
    defaultValues: valoresIniciales(soporte, legalizacion.montoAnticipo.moneda),
  });
  const { register, control, handleSubmit, setValue, setError, formState } = form;
  const errores = formState.errors;
  const lineas = useFieldArray({ control, name: 'lineas' });
  const medioPago = useWatch({ control, name: 'medioPago' });
  const claveFiscal = useWatch({ control, name: 'claveFiscal' });

  const enviar = handleSubmit((datos) =>
    confirmar.mutate(
      { id: legalizacion.id, soporteId: soporte.id, datos },
      {
        onSuccess: alConfirmar,
        onError: (error) => {
          if (error instanceof ApiError) {
            for (const [ruta, claves] of Object.entries(error.erroresCampo)) setError(ruta as Path<ConfirmarSoporteRequest>, { message: claves[0] });
          }
        },
      },
    ),
  );

  return (
    <form noValidate onSubmit={enviar} className="space-y-4">
      {soporte.extraccion && (
        <Alerta tono={soporte.extraccion.confianza === 'BAJA' ? 'aviso' : 'info'} titulo="Datos leídos automáticamente">
          Revíselos contra la foto antes de confirmar. Confianza de la lectura:{' '}
          <Insignia tono={soporte.extraccion.confianza === 'ALTA' ? 'exito' : 'aviso'}>{soporte.extraccion.confianza}</Insignia>
          {soporte.extraccion.observaciones && <p className="mt-1">{soporte.extraccion.observaciones}</p>}
        </Alerta>
      )}
      {!soporte.extraccion && soporte.estado === 'POR_CONFIRMAR' && (
        <Alerta tono="info">La lectura automática no está disponible: digite los datos de la factura.</Alerta>
      )}

      <Tarjeta className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Emisor (quién vendió)" error={errores.emisorNombre?.message} className="sm:col-span-2">
          {(a11y) => <Entrada {...a11y} {...register('emisorNombre')} error={errores.emisorNombre?.message} />}
        </Campo>
        <Campo etiqueta="NIT / CNPJ / Tax ID del emisor">
          {(a11y) => <Entrada {...a11y} {...register('emisorId')} />}
        </Campo>
        <Campo etiqueta="N.º de factura">
          {(a11y) => <Entrada {...a11y} {...register('numeroDocumento')} />}
        </Campo>
        <Campo
          etiqueta="Facturada a (NIT del comprador)"
          ayuda={nitEmpresa ? `Debe ser el NIT de la empresa: ${nitEmpresa}` : undefined}
          className="sm:col-span-2"
        >
          {(a11y) => (
            <div className="flex gap-2">
              <Entrada {...a11y} {...register('adquirienteId')} />
              {nitEmpresa && (
                <Boton variante="secundario" onClick={() => setValue('adquirienteId', nitEmpresa, { shouldDirty: true })}>
                  Es la empresa
                </Boton>
              )}
            </div>
          )}
        </Campo>
        <Campo etiqueta="Fecha" error={errores.fecha?.message}>
          {(a11y) => <Entrada {...a11y} type="date" max={hoyLocal()} {...register('fecha')} error={errores.fecha?.message} />}
        </Campo>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Campo etiqueta="Total pagado" error={errores.total?.message}>
            {(a11y) => <Entrada {...a11y} inputMode="decimal" {...register('total')} error={errores.total?.message} />}
          </Campo>
          <Campo etiqueta="Moneda" error={errores.moneda?.message}>
            {(a11y) => <Entrada {...a11y} maxLength={3} className="uppercase" {...register('moneda')} error={errores.moneda?.message} />}
          </Campo>
        </div>
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
        {medioPago === 'TARJETA' ? (
          <Campo etiqueta="Últimos 4 dígitos de la tarjeta" error={errores.ultimos4Tarjeta?.message}>
            {(a11y) => <Entrada {...a11y} inputMode="numeric" maxLength={4} {...register('ultimos4Tarjeta')} error={errores.ultimos4Tarjeta?.message} />}
          </Campo>
        ) : (
          <div className="hidden sm:block" />
        )}
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
        <Campo etiqueta="País (código)" error={errores.paisCodigo?.message} ayuda="CO, BR, US…">
          {(a11y) => <Entrada {...a11y} maxLength={2} className="uppercase" {...register('paisCodigo')} error={errores.paisCodigo?.message} />}
        </Campo>
        <Campo etiqueta="Clave fiscal" ayuda="CUFE/CUDE (Colombia) o chave de acesso (Brasil), si la tiene">
          {(a11y) => (
            <Seleccion
              {...a11y}
              value={claveFiscal?.tipo ?? ''}
              onChange={(e) => setValue('claveFiscal', e.target.value ? { tipo: e.target.value as 'CUFE', valor: claveFiscal?.valor ?? '' } : null)}
            >
              <option value="">No tiene</option>
              <option value="CUFE">CUFE</option>
              <option value="CUDE">CUDE</option>
              <option value="CHAVE_ACESSO_BR">Chave de acesso (BR)</option>
            </Seleccion>
          )}
        </Campo>
        {claveFiscal && (
          <Campo etiqueta="Valor de la clave">
            {(a11y) => <Entrada {...a11y} className="font-mono text-xs" {...register('claveFiscal.valor')} />}
          </Campo>
        )}
      </Tarjeta>

      <Tarjeta className="space-y-3">
        <div>
          <h3 className="font-semibold">Detalle (líneas)</h3>
          <p className="text-sm text-slate-600">
            Licor, minibar, tabaco, cine y spa se excluyen automáticamente y quedan a su cargo, junto con su parte del impuesto. Incluya las líneas de
            impuesto (IVA, impoconsumo) y de propina tal como aparecen en la factura.
          </p>
        </div>
        {lineas.fields.map((campo, i) => (
          <div key={campo.id} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
            <Campo etiqueta={`Descripción ${i + 1}`} error={errores.lineas?.[i]?.descripcion?.message}>
              {(a11y) => <Entrada {...a11y} {...register(`lineas.${i}.descripcion`)} />}
            </Campo>
            <Campo etiqueta="Valor" error={errores.lineas?.[i]?.valor?.message}>
              {(a11y) => <Entrada {...a11y} inputMode="decimal" {...register(`lineas.${i}.valor`)} />}
            </Campo>
            <Boton variante="fantasma" aria-label={`Quitar línea ${i + 1}`} onClick={() => lineas.remove(i)}>
              ✕
            </Boton>
          </div>
        ))}
        <Boton variante="secundario" onClick={() => lineas.append({ descripcion: '', valor: '' })}>
          + Agregar línea
        </Boton>
        <Campo
          etiqueta="Propina sugerida en la factura"
          ayuda="Si la factura imprime una propina sugerida, escriba su valor: la propina se acepta hasta ese monto."
          error={errores.propinaSugerida?.message}
          className="max-w-xs"
        >
          {(a11y) => <Entrada {...a11y} inputMode="decimal" {...register('propinaSugerida')} />}
        </Campo>
      </Tarjeta>

      {confirmar.isError && <Alerta tono="peligro">{mensajeDeError(confirmar.error)}</Alerta>}
      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Boton type="submit" cargando={confirmar.isPending}>
          Confirmar datos
        </Boton>
      </div>
    </form>
  );
}
