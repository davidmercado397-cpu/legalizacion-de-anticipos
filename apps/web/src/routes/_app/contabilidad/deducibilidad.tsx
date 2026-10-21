import { Link, createFileRoute } from '@tanstack/react-router';
import { useCambiarDeducibilidad, useGastos } from '@viaticos/client-app';
import type { Deducibilidad, Gasto } from '@viaticos/contracts';
import { useState } from 'react';
import { DEDUCIBILIDADES } from '../../../features/gastos/deducibilidad';
import { etiqueta } from '../../../i18n';
import { mensajeDeError } from '../../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../../lib/formato';
import { Seleccion } from '../../../ui/campos';
import { Alerta, EstadoVacio, Esqueleto } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/contabilidad/deducibilidad')({ component: RevisionDeducibilidad });

/** Gastos por su deducibilidad: los «por definir» (p. ej. facturas del exterior) los decide contabilidad. */
function RevisionDeducibilidad() {
  const [filtro, setFiltro] = useState<Deducibilidad>('requires_review');
  const gastos = useGastos({ deductibility: filtro, limit: 100 });
  const cambiar = useCambiarDeducibilidad();

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">La deducibilidad es una sugerencia por el tipo de soporte; el criterio tributario lo define contabilidad.</p>
        <Seleccion aria-label="Mostrar" className="w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as Deducibilidad)}>
          {DEDUCIBILIDADES.map((d) => (
            <option key={d} value={d}>
              {etiqueta('deducibilidad', d)}
            </option>
          ))}
        </Seleccion>
      </div>
      {cambiar.isError && <Alerta tono="peligro">{mensajeDeError(cambiar.error)}</Alerta>}
      {gastos.isPending ? (
        <Esqueleto />
      ) : gastos.isError ? (
        <Alerta tono="peligro">{mensajeDeError(gastos.error)}</Alerta>
      ) : gastos.data.data.length === 0 ? (
        <EstadoVacio titulo="No hay gastos en este estado" />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200">
          {gastos.data.data.map((g) => (
            <Fila key={g.id} gasto={g} ocupado={cambiar.isPending && cambiar.variables?.id === g.id} alCambiar={(d) => cambiar.mutate({ id: g.id, deducibilidad: d })} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Fila({ gasto: g, ocupado, alCambiar }: { gasto: Gasto; ocupado: boolean; alCambiar: (d: Deducibilidad) => void }) {
  const titulo = g.vendor_name ?? 'Sin proveedor';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <div className="min-w-0">
        {g.advance_id ? (
          <Link to="/anticipos/$anticipoId/gastos/$gastoId" params={{ anticipoId: g.advance_id, gastoId: g.id }} className="font-medium text-marca-700 hover:underline">
            {titulo}
          </Link>
        ) : (
          <p className="font-medium">{titulo}</p>
        )}
        <p className="text-sm text-slate-500">
          {formatoFechaCalendario(g.invoice_date)} · {formatoDinero(g.total, g.currency)} · {etiqueta('documento', g.document_type)}
          {g.country && ` · ${g.country}`}
        </p>
      </div>
      <Seleccion
        aria-label={`Deducibilidad de ${titulo}`}
        className="w-auto"
        value={g.deductibility ?? ''}
        disabled={ocupado}
        onChange={(e) => alCambiar(e.target.value as Deducibilidad)}
      >
        {DEDUCIBILIDADES.map((d) => (
          <option key={d} value={d}>
            {etiqueta('deducibilidad', d)}
          </option>
        ))}
      </Seleccion>
    </li>
  );
}
