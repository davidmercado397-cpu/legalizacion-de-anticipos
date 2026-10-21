import { createFileRoute } from '@tanstack/react-router';
import { SelectorCompania } from '../../../features/administracion/selector-compania';
import { GestionAprendizaje } from '../../../features/gastos/aprendizaje';
import { useCompaniaElegida } from '../../../lib/use-compania';

export const Route = createFileRoute('/_app/contabilidad/aprendizaje')({ component: Aprendizaje });

function Aprendizaje() {
  const eleccion = useCompaniaElegida();
  return (
    <div className="space-y-8">
      <SelectorCompania eleccion={eleccion} />
      <GestionAprendizaje companiaId={eleccion.id} />
    </div>
  );
}
