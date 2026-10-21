import { Link, type LinkProps } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

interface EncabezadoProps {
  titulo: ReactNode;
  descripcion?: ReactNode;
  /** Botones a la derecha; en móvil bajan debajo del título. */
  acciones?: ReactNode;
  /** Enlace para volver (ruta de la lista de la que vino). */
  volver?: { to: LinkProps['to']; params?: LinkProps['params']; texto: string };
  /** Algo junto al título (una insignia de estado). */
  junto?: ReactNode;
}

export function EncabezadoPagina({ titulo, descripcion, acciones, volver, junto }: EncabezadoProps) {
  return (
    <header className="space-y-3">
      {volver && (
        <Link
          to={volver.to}
          params={volver.params}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {volver.texto}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[34px]">{titulo}</h1>
            {junto}
          </div>
          {descripcion && <div className="text-[15px] text-slate-600">{descripcion}</div>}
        </div>
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
    </header>
  );
}

/** Una sección de página: título con una línea fina debajo, sin caja alrededor. */
export function Seccion({
  titulo,
  contador,
  acciones,
  className,
  children,
}: {
  titulo: ReactNode;
  contador?: number;
  acciones?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx('space-y-4', className)}>
      <div className="flex min-h-9 flex-wrap items-end justify-between gap-3 border-b border-slate-900 pb-1.5">
        <h2 className="text-lg font-bold tracking-tight text-slate-900">
          {titulo}
          {contador !== undefined && <span className="ml-2 font-semibold text-slate-500">{contador}</span>}
        </h2>
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      {children}
    </section>
  );
}

export interface Pestana {
  to: LinkProps['to'];
  texto: string;
  /** Solo activa en esa ruta exacta (la pestaña índice). */
  exacta?: boolean;
}

/** Subnavegación de una sección (Contabilidad, Administración…). */
export function Pestanas({ etiqueta, pestanas }: { etiqueta: string; pestanas: Pestana[] }) {
  return (
    <nav aria-label={etiqueta} className="-mb-px flex gap-1 overflow-x-auto border-b border-slate-200">
      {pestanas.map((p) => (
        <Link
          key={String(p.to)}
          to={p.to}
          activeOptions={{ exact: p.exacta ?? false }}
          className="whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
          activeProps={{ className: 'border-slate-900 text-slate-900', 'aria-current': 'page' }}
        >
          {p.texto}
        </Link>
      ))}
    </nav>
  );
}
