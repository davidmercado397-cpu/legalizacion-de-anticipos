import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface Columna {
  titulo: string;
  /** Montos y cantidades: a la derecha, cifras alineadas y sin partir. */
  numerica?: boolean;
  /** El encabezado solo existe para el lector de pantalla (p. ej. la columna de acciones). */
  oculta?: boolean;
}

interface TablaProps {
  columnas: Array<string | Columna>;
  filas: ReactNode[][];
  /** Una llave estable por fila; sin ella se usa la posición. */
  claves?: string[];
  /** Una última fila de totales, en negrita. */
  pie?: ReactNode[];
  className?: string;
}

/** Tabla densa de datos: encabezado discreto, filas con hover y montos alineados. */
export function Tabla({ columnas, filas, claves, pie, className }: TablaProps) {
  const cols = columnas.map((c) => (typeof c === 'string' ? { titulo: c } : c));
  const celda = (i: number) =>
    cx('px-3 py-3 first:pl-0 last:pr-0', cols[i]?.numerica && 'whitespace-nowrap text-right tabular-nums');
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            {cols.map((c, i) => (
              <th key={c.titulo || i} scope="col" className={cx(celda(i), 'py-2.5 text-xs font-semibold text-slate-600')}>
                {c.oculta ? <span className="sr-only">{c.titulo}</span> : c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={claves?.[i] ?? i} className="border-b border-slate-100 hover:bg-slate-50">
              {fila.map((contenido, j) => (
                <td key={j} className={celda(j)}>
                  {contenido}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {pie && (
          <tfoot>
            <tr className="font-bold">
              {pie.map((contenido, j) => (
                <td key={j} className={celda(j)}>
                  {contenido}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
