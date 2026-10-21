import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

/** Agrupa algo que va junto (un formulario, una franja de saldo). Las secciones de una página no van en tarjetas. */
export function Tarjeta({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx('rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:p-6', className)} />;
}

export type Tono = 'neutro' | 'info' | 'exito' | 'aviso' | 'peligro';

const TONOS: Record<Tono, string> = {
  neutro: 'bg-slate-100 text-slate-700',
  info: 'bg-marca-50 text-marca-800',
  exito: 'bg-emerald-50 text-emerald-800',
  aviso: 'bg-amber-50 text-amber-900',
  peligro: 'bg-red-50 text-red-800',
};

const ICONOS: Record<Tono, LucideIcon> = {
  neutro: Info,
  info: Info,
  exito: CircleCheck,
  aviso: TriangleAlert,
  peligro: CircleAlert,
};

/** Estado de negocio: punto + texto. El texto dice lo que pasa; el color no es la única señal. */
export function Insignia({ tono = 'neutro', children }: { tono?: Tono; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', TONOS[tono])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

/** Solo un error interrumpe al lector de pantalla (`alert`); lo demás se anuncia sin cortar (`status`). */
export function Alerta({ tono = 'info', titulo, children }: { tono?: Tono; titulo?: string; children?: ReactNode }) {
  const Icono = ICONOS[tono];
  return (
    <div role={tono === 'peligro' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl p-3.5 text-sm', TONOS[tono])}>
      <Icono className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {titulo && <p className="font-semibold">{titulo}</p>}
        {children && <div className={titulo ? 'mt-1' : undefined}>{children}</div>}
      </div>
    </div>
  );
}

/** Para esperas cortas dentro de un bloque; una página o lista que carga usa `Esqueleto`. */
export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-12 text-slate-500">
      <span className="size-5 animate-spin rounded-full border-2 border-marca-600 border-t-transparent" aria-hidden />
      {texto}
    </div>
  );
}

/** Bloques grises con la forma del contenido que viene. */
export function Esqueleto({ filas = 4, className }: { filas?: number; className?: string }) {
  return (
    <div role="status" aria-label="Cargando" className={cx('space-y-3 py-2', className)}>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 flex-1 animate-pulse rounded-md bg-slate-100" style={{ maxWidth: `${90 - (i % 3) * 18}%` }} />
          <div className="h-4 w-20 animate-pulse rounded-md bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/** Lo que se ve cuando no hay nada: qué es y qué hacer (con la acción a la mano). */
export function EstadoVacio({ titulo, icono: Icono, accion, children }: { titulo: string; icono?: LucideIcon; accion?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-4 py-12 text-center">
      {Icono && (
        <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <Icono className="size-5" aria-hidden />
        </span>
      )}
      <p className="font-semibold text-slate-900">{titulo}</p>
      {children && <div className="mt-1 max-w-prose text-sm text-slate-500">{children}</div>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}
