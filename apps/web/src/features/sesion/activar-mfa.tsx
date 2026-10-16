import { zodResolver } from '@hookform/resolvers/zod';
import { useActivarMfa, useContextoSesion, useIniciarMfa } from '@viaticos/client-app';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Campo, Entrada } from '../../ui/campos';
import { Alerta, Cargando } from '../../ui/superficies';
import { sinRechazo } from '../../lib/sin-rechazo';

const esquema = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, 'validation.codigoMfa') });

/**
 * 1) La API genera la semilla y se muestra como QR; 2) el primer código la confirma; 3) se muestran los
 * códigos de recuperación una sola vez. Activarla cierra las sesiones, así que al final se vuelve a entrar.
 */
export function ActivarMfa({ alTerminar }: { alTerminar: () => void }) {
  const iniciar = useIniciarMfa();
  const activar = useActivarMfa();
  const sesion = useContextoSesion();
  const [qr, setQr] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(esquema) });

  const { mutate: generar, data: configuracion } = iniciar;
  useEffect(() => generar(), [generar]);
  useEffect(() => {
    if (configuracion) void QRCode.toDataURL(configuracion.provisioning_uri, { margin: 1, width: 220 }).then(setQr);
  }, [configuracion]);

  if (activar.data) {
    return (
      <div className="space-y-4">
        <Alerta tono="exito" titulo="Verificación en dos pasos activada">
          Guarde estos códigos de recuperación en un lugar seguro. Cada uno sirve una sola vez si pierde el celular. No se volverán a mostrar.
        </Alerta>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
          {activar.data.map((codigo) => (
            <li key={codigo} className="rounded bg-slate-100 px-2 py-1 text-center">
              {codigo}
            </li>
          ))}
        </ul>
        <Boton
          onClick={() => {
            sesion.getState().limpiar();
            alTerminar();
          }}
        >
          Ya los guardé: entrar de nuevo
        </Boton>
      </div>
    );
  }

  if (iniciar.isError) return <Alerta tono="peligro">{mensajeDeError(iniciar.error)}</Alerta>;
  if (!configuracion) return <Cargando />;

  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit(sinRechazo(({ codigo }) => activar.mutateAsync(codigo)))}>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>Instale una aplicación autenticadora (Google Authenticator, Microsoft Authenticator…).</li>
        <li>Escanee el código QR o escriba la clave a mano.</li>
        <li>Escriba el código de 6 dígitos que muestra la aplicación.</li>
      </ol>
      <div className="flex flex-col items-center gap-2">
        {qr && <img src={qr} alt="Código QR para la aplicación autenticadora" className="size-56" />}
        <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{configuracion.secret}</code>
      </div>
      <Campo etiqueta="Código de la aplicación" error={formState.errors.codigo?.message}>
        {(p) => <Entrada {...p} {...register('codigo')} inputMode="numeric" autoComplete="one-time-code" />}
      </Campo>
      {activar.isError && <Alerta tono="peligro">{mensajeDeError(activar.error)}</Alerta>}
      <Boton type="submit" cargando={activar.isPending}>
        Activar
      </Boton>
    </form>
  );
}
