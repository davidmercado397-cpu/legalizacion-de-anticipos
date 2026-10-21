import { createFileRoute } from '@tanstack/react-router';
import { ActivarMfa } from '../../../features/sesion/activar-mfa';
import { EncabezadoPagina } from '../../../ui/pagina';
import { Alerta, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/cuenta/mfa')({ component: PaginaMfa });

function PaginaMfa() {
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto max-w-md space-y-6">
      <EncabezadoPagina titulo="Verificación en dos pasos" />
      <Alerta tono="aviso">Tu rol maneja información sensible: activa la verificación en dos pasos para continuar.</Alerta>
      <Tarjeta>
        <ActivarMfa alTerminar={() => void navigate({ to: '/login' })} />
      </Tarjeta>
    </div>
  );
}
