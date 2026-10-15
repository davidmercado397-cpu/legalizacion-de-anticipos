import { createFileRoute } from '@tanstack/react-router';
import { destinosOptions } from '@viaticos/client-app';
import { FormularioSolicitud } from '../../../features/solicitudes/formulario-solicitud';

export const Route = createFileRoute('/_app/solicitudes/nueva')({
  loader: ({ context }) => context.queryClient.prefetchQuery(destinosOptions(context.api)),
  component: () => (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Nueva solicitud de viaje</h1>
      <FormularioSolicitud />
    </div>
  ),
});
