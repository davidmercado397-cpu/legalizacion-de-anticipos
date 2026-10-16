import { zodResolver } from '@hookform/resolvers/zod';
import { useIniciarSesion, useSesion, useVerificarMfa } from '@viaticos/client-app';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Campo, Entrada } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';
import { sinRechazo } from '../../lib/sin-rechazo';

const esquemaLogin = z.object({
  email: z.string().trim().min(1, 'validation.required').email('validation.email'),
  password: z.string().min(1, 'validation.required'),
});

/**
 * Paso 1: correo y contraseña. Si la cuenta tiene verificación en dos pasos, sigue FormularioMfa.
 * Quien lo usa navega cuando el store queda con sesión.
 */
export function FormularioLogin() {
  const iniciar = useIniciarSesion();
  const estado = useSesion((s) => s.estado);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(esquemaLogin) });

  if (estado === 'mfa') return <FormularioMfa />;

  return (
    <Tarjeta>
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit(sinRechazo((datos) => iniciar.mutateAsync(datos)))}
      >
        <Campo etiqueta="Correo" error={formState.errors.email?.message}>
          {(p) => <Entrada {...p} {...register('email')} type="email" autoComplete="username" autoFocus />}
        </Campo>
        <Campo etiqueta="Contraseña" error={formState.errors.password?.message}>
          {(p) => <Entrada {...p} {...register('password')} type="password" autoComplete="current-password" />}
        </Campo>
        {iniciar.isError && <Alerta tono="peligro">{mensajeDeError(iniciar.error)}</Alerta>}
        <Boton type="submit" className="w-full" cargando={iniciar.isPending}>
          Ingresar
        </Boton>
      </form>
    </Tarjeta>
  );
}

const esquemaMfa = z.object({ codigo: z.string().trim().min(6, 'validation.codigoMfa').max(20) });

function FormularioMfa() {
  const verificar = useVerificarMfa();
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(esquemaMfa) });
  return (
    <Tarjeta>
      <form noValidate className="space-y-4" onSubmit={handleSubmit(sinRechazo(async ({ codigo }) => verificar.mutateAsync(codigo)))}>
        <div>
          <h2 className="font-semibold text-slate-900">Verificación en dos pasos</h2>
          <p className="text-sm text-slate-600">Escriba el código de su aplicación autenticadora, o uno de sus códigos de recuperación.</p>
        </div>
        <Campo etiqueta="Código" error={formState.errors.codigo?.message}>
          {(p) => <Entrada {...p} {...register('codigo')} inputMode="numeric" autoComplete="one-time-code" autoFocus />}
        </Campo>
        {verificar.isError && <Alerta tono="peligro">{mensajeDeError(verificar.error)}</Alerta>}
        <Boton type="submit" className="w-full" cargando={verificar.isPending}>
          Verificar
        </Boton>
      </form>
    </Tarjeta>
  );
}
