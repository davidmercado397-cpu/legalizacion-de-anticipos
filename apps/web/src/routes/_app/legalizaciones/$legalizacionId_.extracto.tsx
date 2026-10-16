import { Link, createFileRoute } from '@tanstack/react-router';
import { CargarExtracto } from '../../../features/conciliacion/cargar-extracto';

export const Route = createFileRoute('/_app/legalizaciones/$legalizacionId_/extracto')({
  component: PaginaCargarExtracto,
});

function PaginaCargarExtracto() {
  const { legalizacionId } = Route.useParams();
  return (
    <div className="space-y-3">
      <Link to="/legalizaciones/$legalizacionId" params={{ legalizacionId }} className="text-sm text-marca-700 hover:underline">
        ← Volver a la legalización
      </Link>
      <h1 className="text-2xl font-bold">Cargar extracto de la tarjeta</h1>
      <p className="text-sm text-slate-600">
        Los cargos del extracto se cruzan con las facturas pagadas con tarjeta (de esta y otras legalizaciones del mismo viajero en el periodo).
      </p>
      <CargarExtracto legalizacionId={legalizacionId} />
    </div>
  );
}
