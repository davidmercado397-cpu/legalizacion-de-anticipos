import { createFileRoute } from '@tanstack/react-router';
import { ReglasAprobacion } from '../../../features/administracion/reglas-aprobacion';
import { ReglasPolitica } from '../../../features/administracion/reglas-politica';
import { SelectorCompania } from '../../../features/administracion/selector-compania';
import { useCompaniaElegida } from '../../../lib/use-compania';
import { Seccion } from '../../../ui/pagina';

export const Route = createFileRoute('/_app/contabilidad/politica')({ component: Politica });

function Politica() {
  const eleccion = useCompaniaElegida();
  return (
    <div className="space-y-12">
      <SelectorCompania eleccion={eleccion} />
      <Seccion titulo="Reglas de la política de gastos">
        <p className="-mt-1 max-w-prose text-sm text-slate-600">
          Qué revisa el sistema en cada factura y qué hace si la regla se cumple: avisar, pedir justificación, mandarla a revisión o bloquearla.
        </p>
        {eleccion.id && <ReglasPolitica key={eleccion.id} companiaId={eleccion.id} />}
      </Seccion>
      <Seccion titulo="Escalamiento al jefe directivo">
        {eleccion.id && <ReglasAprobacion key={eleccion.id} companiaId={eleccion.id} />}
      </Seccion>
    </div>
  );
}
