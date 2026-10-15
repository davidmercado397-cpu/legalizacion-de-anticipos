import { zodResolver } from '@hookform/resolvers/zod';
import { useRegistrarDesembolso } from '@viaticos/client-app';
import { medioDesembolsoSchema, registrarDesembolsoRequestSchema, type RegistrarDesembolsoRequest } from '@viaticos/contracts';
import { useForm } from 'react-hook-form';
import { t } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { hoyLocal } from '../../lib/fechas';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta } from '../../ui/superficies';

export function FormularioDesembolso({ anticipoId }: { anticipoId: string }) {
  const desembolsar = useRegistrarDesembolso();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegistrarDesembolsoRequest>({
    resolver: zodResolver(registrarDesembolsoRequestSchema),
    defaultValues: { fecha: hoyLocal(), medio: 'TRANSFERENCIA', referencia: '' },
  });

  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
      onSubmit={handleSubmit((datos) => desembolsar.mutate({ id: anticipoId, datos }))}
    >
      <Campo etiqueta="Fecha del pago" error={errors.fecha?.message}>
        {(a11y) => <Entrada {...a11y} type="date" max={hoyLocal()} {...register('fecha')} error={errors.fecha?.message} />}
      </Campo>
      <Campo etiqueta="Medio">
        {(a11y) => (
          <Seleccion {...a11y} {...register('medio')}>
            {medioDesembolsoSchema.options.map((m) => (
              <option key={m} value={m}>
                {t(`medio.${m}`)}
              </option>
            ))}
          </Seleccion>
        )}
      </Campo>
      <Campo etiqueta="Referencia (opcional)">
        {(a11y) => <Entrada {...a11y} placeholder="N.º de transferencia" {...register('referencia')} />}
      </Campo>
      <Boton type="submit" cargando={desembolsar.isPending}>
        Registrar desembolso
      </Boton>
      {desembolsar.isError && (
        <div className="sm:col-span-4">
          <Alerta tono="peligro">{mensajeDeError(desembolsar.error)}</Alerta>
        </div>
      )}
    </form>
  );
}
