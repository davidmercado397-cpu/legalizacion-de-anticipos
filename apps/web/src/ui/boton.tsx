import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../lib/cx';

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma';

const ESTILOS: Record<Variante, string> = {
  primario: 'bg-marca-700 text-white hover:bg-marca-800 disabled:bg-marca-700/50',
  secundario: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  peligro: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/50',
  fantasma: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
};

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  cargando?: boolean;
}

export function Boton({ variante = 'primario', cargando = false, className, children, disabled, ...props }: BotonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
        ESTILOS[variante],
        className,
      )}
    >
      {cargando && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}
