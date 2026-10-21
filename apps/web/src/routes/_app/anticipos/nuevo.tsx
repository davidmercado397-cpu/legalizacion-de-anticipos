import { createFileRoute } from '@tanstack/react-router';
import { FormularioSolicitud } from '../../../features/anticipos/formulario-solicitud';
import { EncabezadoPagina } from '../../../ui/pagina';

export const Route = createFileRoute('/_app/anticipos/nuevo')({ component: NuevoAnticipo });

function NuevoAnticipo() {
  const navigate = Route.useNavigate();
  return (
    <div className="space-y-6">
      <EncabezadoPagina titulo="Solicitar anticipo" volver={{ to: '/anticipos', texto: 'Mis anticipos' }} />
      <FormularioSolicitud alCrear={(a) => void navigate({ to: '/anticipos/$anticipoId', params: { anticipoId: a.id } })} />
    </div>
  );
}
