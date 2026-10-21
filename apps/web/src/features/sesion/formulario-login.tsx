import { zodResolver } from '@hookform/resolvers/zod';
import { useIniciarSesion, useSesion, useVerificarMfa } from '@viaticos/client-app';
import { ArrowLeft, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Campo, Entrada } from '../../ui/campos';
import { Alerta } from '../../ui/superficies';
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
  const [verClave, setVerClave] = useState(false);

  if (estado === 'mfa') return <FormularioMfa />;

  return (
    <form noValidate className="space-y-6" onSubmit={handleSubmit(sinRechazo((datos) => iniciar.mutateAsync(datos)))}>
      <div className="space-y-1.5">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Ingresa a tu cuenta</h1>
        <p className="text-[15px] text-slate-600">Con el correo de tu empresa.</p>
      </div>
      <div className="space-y-4">
        <Campo etiqueta="Correo" error={formState.errors.email?.message}>
          {(p) => <Entrada {...p} {...register('email')} type="email" autoComplete="username" autoFocus />}
        </Campo>
        <Campo etiqueta="Contraseña" error={formState.errors.password?.message} ayuda="Si la olvidaste, pídele una temporal al administrador.">
          {(p) => (
            <div className="relative">
              <Entrada {...p} {...register('password')} type={verClave ? 'text' : 'password'} autoComplete="current-password" className="pr-12" />
              <button
                type="button"
                aria-label={verClave ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                aria-pressed={verClave}
                onClick={() => setVerClave(!verClave)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[10px] text-slate-500 hover:text-slate-900"
              >
                {verClave ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
          )}
        </Campo>
      </div>
      {iniciar.isError && <Alerta tono="peligro">{mensajeDeError(iniciar.error)}</Alerta>}
      <Boton type="submit" className="w-full" cargando={iniciar.isPending}>
        Ingresar
      </Boton>
    </form>
  );
}

const esquemaMfa = z.object({ codigo: z.string().trim().min(6, 'validation.codigoMfa').max(20) });

function FormularioMfa() {
  const verificar = useVerificarMfa();
  const limpiar = useSesion((s) => s.limpiar);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(esquemaMfa) });
  return (
    <form noValidate className="space-y-6" onSubmit={handleSubmit(sinRechazo(async ({ codigo }) => verificar.mutateAsync(codigo)))}>
      <div className="space-y-1.5">
        <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-marca-50 text-marca-700">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Verificación en dos pasos</h1>
        <p className="text-[15px] text-slate-600">Escribe el código de tu aplicación autenticadora, o uno de tus códigos de recuperación.</p>
      </div>
      <Campo etiqueta="Código" error={formState.errors.codigo?.message}>
        {(p) => (
          <Entrada
            {...p}
            {...register('codigo')}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            className="text-center font-mono text-lg tracking-[0.3em]"
          />
        )}
      </Campo>
      {verificar.isError && <Alerta tono="peligro">{mensajeDeError(verificar.error)}</Alerta>}
      <div className="space-y-2">
        <Boton type="submit" className="w-full" cargando={verificar.isPending}>
          Verificar
        </Boton>
        <Boton variante="fantasma" className="w-full" onClick={limpiar}>
          <ArrowLeft aria-hidden />
          Usar otra cuenta
        </Boton>
      </div>
    </form>
  );
}
