import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { SelectorCompania } from '../../../features/administracion/selector-compania';
import { Tablero } from '../../../features/reportes/tablero';
import { useCompaniaElegida } from '../../../lib/use-compania';
import { Entrada, Seleccion } from '../../../ui/campos';

export const Route = createFileRoute('/_app/contabilidad/reportes')({ component: Reportes });

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Los rangos que más se usan; el personalizado se escribe en las fechas. */
function rango(preset: string): { start: string; end: string } {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  switch (preset) {
    case 'mes_anterior':
      return { start: iso(new Date(Date.UTC(y, m - 1, 1))), end: iso(new Date(Date.UTC(y, m, 0))) };
    case '90_dias':
      return { start: iso(new Date(hoy.getTime() - 89 * 86_400_000)), end: iso(hoy) };
    case 'anio':
      return { start: `${y}-01-01`, end: iso(hoy) };
    default:
      return { start: iso(new Date(Date.UTC(y, m, 1))), end: iso(hoy) };
  }
}

function Reportes() {
  const eleccion = useCompaniaElegida();
  const [preset, setPreset] = useState('mes');
  const [fechas, setFechas] = useState(() => rango('mes'));
  const elegir = (p: string) => {
    setPreset(p);
    if (p !== 'otro') setFechas(rango(p));
  };
  const moneda = eleccion.compania?.currency ?? 'COP';
  const periodo = { ...fechas, ...(eleccion.companias.length > 1 && eleccion.id ? { company_id: eleccion.id } : {}) };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2">
        <Seleccion aria-label="Periodo" className="w-auto" value={preset} onChange={(e) => elegir(e.target.value)}>
          <option value="mes">Este mes</option>
          <option value="mes_anterior">Mes anterior</option>
          <option value="90_dias">Últimos 90 días</option>
          <option value="anio">Este año</option>
          <option value="otro">Otro rango</option>
        </Seleccion>
        <Entrada
          aria-label="Desde"
          type="date"
          className="w-auto"
          value={fechas.start}
          onChange={(e) => {
            setPreset('otro');
            setFechas({ ...fechas, start: e.target.value });
          }}
        />
        <Entrada
          aria-label="Hasta"
          type="date"
          className="w-auto"
          value={fechas.end}
          onChange={(e) => {
            setPreset('otro');
            setFechas({ ...fechas, end: e.target.value });
          }}
        />
        <SelectorCompania eleccion={eleccion} />
      </div>
      {fechas.start && fechas.end && fechas.start <= fechas.end && <Tablero periodo={periodo} moneda={moneda} companiaId={eleccion.id} />}
    </div>
  );
}
