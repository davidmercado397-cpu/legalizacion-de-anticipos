import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../lib/cx';

export type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma';
export type Tamano = 'normal' | 'pequeno';

const ESTILOS: Record<Variante, string> = {
  primario: 'bg-navy-950 text-white hover:bg-navy-800 disabled:bg-slate-300',
  secundario: 'bg-white text-slate-900 ring-1 ring-slate-300 ring-inset hover:bg-slate-50 hover:ring-slate-400 disabled:text-slate-400',
  peligro: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/50',
  fantasma: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-400',
};

const TAMANOS: Record<Tamano, string> = {
  normal: 'min-h-11 rounded-[10px] px-4 text-sm',
  pequeno: 'min-h-9 rounded-lg px-3 text-[13px]',
};

/** Las clases de un botón, para lo que debe verse como botón sin serlo (un `Link`). */
export function botonClases({ variante = 'primario', tamano = 'normal', className }: { variante?: Variante; tamano?: Tamano; className?: string | undefined } = {}) {
  return cx(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0',
    TAMANOS[tamano],
    ESTILOS[variante],
    className,
  );
}

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamano?: Tamano;
  cargando?: boolean;
}

export function Boton({ variante = 'primario', tamano = 'normal', cargando = false, className, children, disabled, ...props }: BotonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={botonClases({ variante, tamano, className })}
    >
      {cargando && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}
