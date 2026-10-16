import { createFileRoute } from '@tanstack/react-router';
import { FormularioSolicitud } from '../../../features/anticipos/formulario-solicitud';

export const Route = createFileRoute('/_app/anticipos/nuevo')({ component: NuevoAnticipo });

function NuevoAnticipo() {
  const navigate = Route.useNavigate();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Solicitar anticipo</h1>
      <FormularioSolicitud alCrear={(a) => void navigate({ to: '/anticipos/$anticipoId', params: { anticipoId: a.id } })} />
    </div>
  );
}
