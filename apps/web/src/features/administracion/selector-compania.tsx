import { Seleccion } from '../../ui/campos';
import type { useCompaniaElegida } from '../../lib/use-compania';

/** Solo aparece si el usuario trabaja con más de una compañía. */
export function SelectorCompania({ eleccion }: { eleccion: ReturnType<typeof useCompaniaElegida> }) {
  if (eleccion.companias.length < 2) return null;
  return (
    <Seleccion aria-label="Compañía" className="w-auto" value={eleccion.id ?? ''} onChange={(e) => eleccion.elegir(e.target.value)}>
      {eleccion.companias.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Seleccion>
  );
}
