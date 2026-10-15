import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export function Tarjeta({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx('rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6', className)} />;
}

type Tono = 'neutro' | 'info' | 'exito' | 'aviso' | 'peligro';

const TONOS: Record<Tono, string> = {
  neutro: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-marca-50 text-marca-800 ring-marca-100',
  exito: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  aviso: 'bg-amber-50 text-amber-900 ring-amber-200',
  peligro: 'bg-red-50 text-red-800 ring-red-200',
};

export function Insignia({ tono = 'neutro', children }: { tono?: Tono; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1', TONOS[tono])}>
      {children}
    </span>
  );
}

export function Alerta({ tono = 'info', titulo, children }: { tono?: Tono; titulo?: string; children?: ReactNode }) {
  return (
    <div role={tono === 'peligro' ? 'alert' : 'status'} className={cx('rounded-lg p-3 text-sm ring-1', TONOS[tono])}>
      {titulo && <p className="font-semibold">{titulo}</p>}
      {children && <div className={titulo ? 'mt-1' : undefined}>{children}</div>}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-12 text-slate-500">
      <span className="size-5 animate-spin rounded-full border-2 border-marca-600 border-t-transparent" aria-hidden />
      {texto}
    </div>
  );
}

export function EstadoVacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center">
      <p className="font-semibold text-slate-800">{titulo}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}
