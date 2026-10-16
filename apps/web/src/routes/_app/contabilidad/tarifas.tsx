import { createFileRoute } from '@tanstack/react-router';
import { SelectorCompania } from '../../../features/administracion/selector-compania';
import { TarifasViaje } from '../../../features/administracion/tarifas';
import { useCompaniaElegida } from '../../../lib/use-compania';

export const Route = createFileRoute('/_app/contabilidad/tarifas')({ component: Tarifas });

function Tarifas() {
  const eleccion = useCompaniaElegida();
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <SelectorCompania eleccion={eleccion} />
      </div>
      {eleccion.id && <TarifasViaje key={eleccion.id} companiaId={eleccion.id} />}
    </div>
  );
}
