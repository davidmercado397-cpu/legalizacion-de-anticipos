import { Link, createFileRoute } from '@tanstack/react-router';
import { useAnticipo } from '@viaticos/client-app';
import { EditorGasto } from '../../../features/gastos/editor-gasto';
import { mensajeDeError } from '../../../lib/errores';
import { Alerta, Cargando, EstadoVacio } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/anticipos/$anticipoId_/gastos/$gastoId')({ component: DetalleGasto });

/** El gasto se toma del detalle del anticipo: trae la foto, las líneas y el estado de la legalización. */
function DetalleGasto() {
  const { anticipoId, gastoId } = Route.useParams();
  const { data: anticipo, isPending, error } = useAnticipo(anticipoId);
  if (isPending) return <Cargando />;
  if (error) return <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>;
  const gasto = anticipo.expenses.find((g) => g.id === gastoId);
  return (
    <div className="space-y-4">
      <Link to="/anticipos/$anticipoId" params={{ anticipoId }} className="text-sm font-semibold text-marca-700 hover:underline">
        ← {anticipo.destination ?? anticipo.purpose}
      </Link>
      {gasto ? <EditorGasto anticipo={anticipo} gasto={gasto} /> : <EstadoVacio titulo="Este gasto ya no está en el anticipo" />}
    </div>
  );
}
