import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

const COLUMNAS = { 2: 'grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4' } as const;

/** Varias cifras en una sola franja dividida, no en tarjetas sueltas: se leen juntas, como un resumen. */
export function Cifras({ columnas, children }: { columnas: keyof typeof COLUMNAS; children: ReactNode }) {
  return <dl className={cx('grid gap-px overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-200', COLUMNAS[columnas])}>{children}</dl>;
}

/** Una cifra con el dato que la explica debajo. `peligro` pinta el número solo cuando es un problema. */
export function Cifra({ titulo, valor, peligro, children }: { titulo: string; valor: string; peligro?: boolean; children?: ReactNode }) {
  return (
    <div className="space-y-1 bg-white p-4">
      <dt className="text-sm text-slate-600">{titulo}</dt>
      <dd className={cx('text-xl font-bold tracking-tight tabular-nums', peligro ? 'text-red-700' : 'text-slate-900')}>{valor}</dd>
      {children && <dd className="text-xs text-slate-500">{children}</dd>}
    </div>
  );
}
