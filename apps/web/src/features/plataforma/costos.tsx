import { useCostosIa } from '@viaticos/client-app';
import type { TotalesCostoIa } from '@viaticos/contracts';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { Entrada } from '../../ui/campos';
import { Alerta, Cargando, Insignia, Tarjeta } from '../../ui/superficies';
import { Columnas, Indicador } from '../reportes/graficos';

const usd = (valor: string | number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(valor));
const compacto = (n: number) => new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const nombreMes = (mes: string, mesCorto = false) =>
  new Intl.DateTimeFormat('es-CO', { month: mesCorto ? 'short' : 'long', year: mesCorto ? '2-digit' : 'numeric', timeZone: 'UTC' }).format(
    new Date(`${mes}-01T00:00:00Z`),
  );
const tokens = (t: TotalesCostoIa) => `${compacto(t.prompt_tokens)} de entrada (${compacto(t.cached_tokens)} en caché) · ${compacto(t.completion_tokens)} de salida`;

/** Costo de la IA por mes, modelo y compañía: lecturas de facturas y de extractos. Sin tope: nunca se degrada por costo. */
export function CostosIa() {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const costos = useCostosIa(desde || undefined, hasta || undefined);
  if (costos.isPending) return <Cargando />;
  if (costos.isError) return <Alerta tono="peligro">{mensajeDeError(costos.error)}</Alerta>;
  const c = costos.data;
  const meses = [...c.months].reverse();

  return (
    <div className={costos.isPlaceholderData ? 'space-y-6 opacity-60' : 'space-y-6'}>
      <div className="flex flex-wrap items-end gap-2">
        <Entrada aria-label="Desde el mes" type="month" className="w-auto" value={desde || c.from_month} onChange={(e) => setDesde(e.target.value)} />
        <Entrada aria-label="Hasta el mes" type="month" className="w-auto" value={hasta || c.to_month} onChange={(e) => setHasta(e.target.value)} />
      </div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Indicador titulo="Costo del periodo" valor={usd(c.totals.cost_usd)} detalle={`${nombreMes(c.from_month)} – ${nombreMes(c.to_month)}`} />
        <Indicador titulo="Llamadas al modelo" valor={compacto(c.totals.calls)} detalle="incluye escalamientos y respaldos" />
        <Indicador titulo="Tokens" valor={compacto(c.totals.prompt_tokens + c.totals.completion_tokens)} detalle={tokens(c.totals)} />
      </dl>
      <Tarjeta>
        <h2 className="mb-3 font-semibold text-slate-700">Costo por mes (USD)</h2>
        <Columnas
          etiqueta="Costo de la IA por mes"
          filas={meses.map((m) => ({
            etiqueta: nombreMes(m.month, true),
            valor: Number(m.totals.cost_usd),
            texto: usd(m.totals.cost_usd),
            detalle: `${nombreMes(m.month)}: ${m.totals.calls} llamadas · ${tokens(m.totals)}`,
          }))}
        />
      </Tarjeta>
      {c.months
        .filter((m) => m.totals.calls > 0)
        .map((m) => (
          <section key={m.month} className="space-y-2">
            <h2 className="font-semibold text-slate-700">
              {nombreMes(m.month)} · {usd(m.totals.cost_usd)}
            </h2>
            <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-2">Modelo</th>
                    <th className="px-4 py-2">Compañía</th>
                    <th className="px-4 py-2 text-right">Llamadas</th>
                    <th className="px-4 py-2 text-right">Tokens</th>
                    <th className="px-4 py-2 text-right">Costo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {m.models.flatMap((modelo) =>
                    modelo.companies.map((co, i) => (
                      <tr key={`${modelo.model}-${co.company_id ?? 'sin'}`}>
                        <td className="px-4 py-2 font-mono text-xs">{i === 0 ? modelo.model : ''}</td>
                        <td className="px-4 py-2">
                          {co.company_name ?? 'Sin compañía'} {co.is_test && <Insignia>Prueba</Insignia>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{co.calls}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{compacto(co.prompt_tokens + co.completion_tokens)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{usd(co.cost_usd)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </div>
  );
}
