import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema, type LoginRequest } from '@viaticos/contracts';
import { useIniciarSesion } from '@viaticos/client-app';
import { useForm } from 'react-hook-form';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Campo, Entrada } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';

export function FormularioLogin({ alIngresar }: { alIngresar: () => void }) {
  const iniciar = useIniciarSesion();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema), defaultValues: { email: '', contrasena: '' } });

  return (
    <Tarjeta>
      <form noValidate className="space-y-4" onSubmit={handleSubmit((datos) => iniciar.mutate(datos, { onSuccess: alIngresar }))}>
        {iniciar.isError && <Alerta tono="peligro">{mensajeDeError(iniciar.error)}</Alerta>}
        <Campo etiqueta="Correo corporativo" error={errors.email?.message}>
          {(a11y) => <Entrada {...a11y} {...register('email')} type="email" autoComplete="username" error={errors.email?.message} />}
        </Campo>
        <Campo etiqueta="Contraseña" error={errors.contrasena?.message}>
          {(a11y) => (
            <Entrada {...a11y} {...register('contrasena')} type="password" autoComplete="current-password" error={errors.contrasena?.message} />
          )}
        </Campo>
        <Boton type="submit" className="w-full" cargando={iniciar.isPending}>
          Ingresar
        </Boton>
      </form>
    </Tarjeta>
  );
}
