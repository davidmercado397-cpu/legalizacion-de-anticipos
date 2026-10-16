import { createFileRoute } from '@tanstack/react-router';
import { ReglasAprobacion } from '../../../features/administracion/reglas-aprobacion';
import { ReglasPolitica } from '../../../features/administracion/reglas-politica';
import { SelectorCompania } from '../../../features/administracion/selector-compania';
import { useCompaniaElegida } from '../../../lib/use-compania';

export const Route = createFileRoute('/_app/contabilidad/politica')({ component: Politica });

function Politica() {
  const eleccion = useCompaniaElegida();
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-700">Reglas de la política de gastos</h2>
          <SelectorCompania eleccion={eleccion} />
        </div>
        {eleccion.id && <ReglasPolitica companiaId={eleccion.id} />}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">Escalamiento al jefe directivo</h2>
        {eleccion.id && <ReglasAprobacion companiaId={eleccion.id} />}
      </section>
    </div>
  );
}
