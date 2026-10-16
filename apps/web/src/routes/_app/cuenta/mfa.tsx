import { createFileRoute } from '@tanstack/react-router';
import { ActivarMfa } from '../../../features/sesion/activar-mfa';
import { Alerta, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/cuenta/mfa')({ component: PaginaMfa });

function PaginaMfa() {
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-bold">Verificación en dos pasos</h1>
      <Alerta tono="aviso">Su rol maneja información sensible: active la verificación en dos pasos para continuar.</Alerta>
      <Tarjeta>
        <ActivarMfa alTerminar={() => void navigate({ to: '/login' })} />
      </Tarjeta>
    </div>
  );
}
