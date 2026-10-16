import { createFileRoute } from '@tanstack/react-router';
import { useSesion } from '@viaticos/client-app';
import { FormularioClave } from '../../../features/sesion/formulario-clave';
import { Alerta, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/cuenta/clave')({ component: PaginaClave });

function PaginaClave() {
  const temporal = useSesion((s) => s.usuario?.must_change_password ?? false);
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-bold">Cambiar contraseña</h1>
      {temporal && <Alerta tono="aviso">Su contraseña es temporal: cámbiela para continuar.</Alerta>}
      <Tarjeta>
        <FormularioClave alTerminar={() => void navigate({ to: '/' })} />
      </Tarjeta>
    </div>
  );
}
