import { useState } from 'react';
import { cx } from '../../lib/cx';

/** Un número con su etiqueta. El valor va en la tinta del texto; `alerta` solo agrega una marca, nunca color al número. */
export function Indicador({ titulo, valor, detalle, alerta = false }: { titulo: string; valor: string; detalle?: string; alerta?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <dt className="flex items-center gap-1.5 text-sm text-slate-500">
        {alerta && <span aria-label="Requiere atención" className="size-2 rounded-full bg-amber-500" />}
        {titulo}
      </dt>
      <dd className="mt-1 text-2xl font-semibold text-slate-900">{valor}</dd>
      {detalle && <dd className="text-xs text-slate-500">{detalle}</dd>}
    </div>
  );
}

export interface Barra {
  etiqueta: string;
  valor: number;
  /** El valor ya formateado (moneda, %), que va en la punta de la barra. */
  texto: string;
  detalle?: string;
}

/**
 * Magnitud de una sola serie: barras horizontales de un tono (sin leyenda: el título dice qué se mide), de máximo
 * 20px, punta redondeada y base recta, con el valor en la punta. Cada barra muestra su detalle al pasar o enfocar.
 */
export function BarrasHorizontales({ filas, etiqueta }: { filas: Barra[]; etiqueta: string }) {
  const [activa, setActiva] = useState<number | null>(null);
  const maximo = Math.max(...filas.map((f) => f.valor), 0);
  return (
    <ul aria-label={etiqueta} className="space-y-2">
      {filas.map((f, i) => (
        <li
          key={f.etiqueta}
          tabIndex={0}
          aria-label={`${f.etiqueta}: ${f.texto}${f.detalle ? `, ${f.detalle}` : ''}`}
          className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3 rounded-md py-1 outline-none focus-visible:ring-2 focus-visible:ring-marca-600"
          onPointerEnter={() => setActiva(i)}
          onPointerLeave={() => setActiva(null)}
          onFocus={() => setActiva(i)}
          onBlur={() => setActiva(null)}
        >
          <span className="truncate text-sm text-slate-700">{f.etiqueta}</span>
          <span className="flex items-center gap-2">
            <span
              className={cx('h-5 rounded-r bg-marca-600 transition-[filter]', activa === i && 'brightness-110')}
              style={{ width: `${maximo > 0 ? Math.max((f.valor / maximo) * 100, 0.5) : 0}%`, maxWidth: 'calc(100% - 7rem)' }}
            />
            <span className="whitespace-nowrap text-sm font-medium text-slate-900">{f.texto}</span>
            {activa === i && f.detalle && <span className="whitespace-nowrap text-xs text-slate-500">{f.detalle}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Una fracción contra el 100 %: el riel es un tono más claro de la misma rampa. */
export function Medidor({ etiqueta, fraccion }: { etiqueta: string; fraccion: number }) {
  const pct = Math.round(Math.min(Math.max(fraccion, 0), 1) * 100);
  return (
    <div className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm">
      <span className="text-slate-700">{etiqueta}</span>
      <span role="meter" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 rounded-full bg-marca-100">
        <span className="block h-2 rounded-full bg-marca-600" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right font-medium tabular-nums text-slate-900">{pct} %</span>
    </div>
  );
}

/**
 * Una serie en el tiempo: columnas de un tono, de máximo 24px, punta redondeada y base recta, con el valor sobre la
 * columna. Cada columna muestra su detalle al pasar o enfocar.
 */
export function Columnas({ filas, etiqueta, alto = 160 }: { filas: Barra[]; etiqueta: string; alto?: number }) {
  const [activa, setActiva] = useState<number | null>(null);
  const maximo = Math.max(...filas.map((f) => f.valor), 0);
  return (
    <div className="space-y-2">
      <ul aria-label={etiqueta} className="flex items-end gap-2 border-b border-slate-200" style={{ height: alto + 24 }}>
        {filas.map((f, i) => (
          <li
            key={f.etiqueta}
            tabIndex={0}
            aria-label={`${f.etiqueta}: ${f.texto}${f.detalle ? `, ${f.detalle}` : ''}`}
            className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1 outline-none focus-visible:ring-2 focus-visible:ring-marca-600"
            style={{ height: '100%' }}
            onPointerEnter={() => setActiva(i)}
            onPointerLeave={() => setActiva(null)}
            onFocus={() => setActiva(i)}
            onBlur={() => setActiva(null)}
          >
            <span className="whitespace-nowrap text-xs font-medium text-slate-900">{f.texto}</span>
            <span
              className={cx('w-full max-w-6 rounded-t bg-marca-600 transition-[filter]', activa === i && 'brightness-110')}
              style={{ height: maximo > 0 ? Math.max((f.valor / maximo) * alto, f.valor > 0 ? 2 : 0) : 0 }}
            />
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        {filas.map((f, i) => (
          <span key={f.etiqueta} className={cx('min-w-0 flex-1 truncate text-center text-xs', activa === i ? 'text-slate-900' : 'text-slate-500')}>
            {f.etiqueta}
          </span>
        ))}
      </div>
      <p className="h-4 text-xs text-slate-500">{activa !== null && filas[activa]?.detalle}</p>
    </div>
  );
}
