import { zodResolver } from '@hookform/resolvers/zod';
import { useCambiarClave } from '@viaticos/client-app';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Campo, Entrada } from '../../ui/campos';
import { Alerta } from '../../ui/superficies';
import { sinRechazo } from '../../lib/sin-rechazo';

const esquema = z
  .object({
    actual: z.string().min(1, 'validation.required'),
    nueva: z.string().min(1, 'validation.required'),
    repetir: z.string().min(1, 'validation.required'),
  })
  .refine((d) => d.nueva === d.repetir, { path: ['repetir'], message: 'validation.claveDistinta' });

/** La política de contraseñas la valida la API (largo mínimo, que no contenga el correo…). */
export function FormularioClave({ alTerminar }: { alTerminar: () => void }) {
  const cambiar = useCambiarClave();
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(esquema) });
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit(sinRechazo(async ({ actual, nueva }) => {
        await cambiar.mutateAsync({ actual, nueva });
        alTerminar();
      }))}
    >
      <Campo etiqueta="Contraseña actual (o la temporal que le dieron)" error={formState.errors.actual?.message}>
        {(p) => <Entrada {...p} {...register('actual')} type="password" autoComplete="current-password" />}
      </Campo>
      <Campo etiqueta="Contraseña nueva" error={formState.errors.nueva?.message} ayuda="Mínimo 10 caracteres.">
        {(p) => <Entrada {...p} {...register('nueva')} type="password" autoComplete="new-password" />}
      </Campo>
      <Campo etiqueta="Repita la contraseña nueva" error={formState.errors.repetir?.message}>
        {(p) => <Entrada {...p} {...register('repetir')} type="password" autoComplete="new-password" />}
      </Campo>
      {cambiar.isError && <Alerta tono="peligro">{mensajeDeError(cambiar.error)}</Alerta>}
      <Boton type="submit" cargando={cambiar.isPending}>
        Cambiar contraseña
      </Boton>
    </form>
  );
}
