import { Link, createFileRoute } from '@tanstack/react-router';
import { useCambiarDeducibilidad, useGastos } from '@viaticos/client-app';
import type { Deducibilidad } from '@viaticos/contracts';
import { Scale } from 'lucide-react';
import { useState } from 'react';
import { DEDUCIBILIDADES } from '../../../features/gastos/deducibilidad';
import { etiqueta } from '../../../i18n';
import { mensajeDeError } from '../../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../../lib/formato';
import { Campo, Seleccion } from '../../../ui/campos';
import { EstadoConsulta } from '../../../ui/estado-consulta';
import { Seccion } from '../../../ui/pagina';
import { Alerta, EstadoVacio } from '../../../ui/superficies';
import { Tabla } from '../../../ui/tabla';

export const Route = createFileRoute('/_app/contabilidad/deducibilidad')({ component: RevisionDeducibilidad });

/** Gastos por su deducibilidad: los «por definir» (p. ej. facturas del exterior) los decide contabilidad. */
function RevisionDeducibilidad() {
  const [filtro, setFiltro] = useState<Deducibilidad>('requires_review');
  const gastos = useGastos({ deductibility: filtro, limit: 100 });
  const cambiar = useCambiarDeducibilidad();

  return (
    <Seccion titulo="Deducibilidad de los gastos" {...(gastos.data ? { contador: gastos.data.data.length } : {})}>
      <p className="-mt-1 max-w-prose text-sm text-slate-600">
        Es una sugerencia por el tipo de soporte; el criterio tributario lo define contabilidad. Los «por revisar» (por ejemplo facturas del
        exterior) los decides tú.
      </p>
      <Campo etiqueta="Mostrar">
        {(p) => (
          <Seleccion {...p} className="w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as Deducibilidad)}>
            {DEDUCIBILIDADES.map((d) => (
              <option key={d} value={d}>
                {etiqueta('deducibilidad', d)}
              </option>
            ))}
          </Seleccion>
        )}
      </Campo>
      {cambiar.isError && <Alerta tono="peligro">{mensajeDeError(cambiar.error)}</Alerta>}
      <EstadoConsulta consulta={gastos}>
        {(pagina) =>
          pagina.data.length === 0 ? (
            <EstadoVacio titulo="No hay gastos en este estado" icono={Scale} />
          ) : (
            <Tabla
              columnas={['Proveedor', { titulo: 'Soporte', secundaria: true }, { titulo: 'Valor', numerica: true }, 'Deducibilidad']}
              claves={pagina.data.map((g) => g.id)}
              filas={pagina.data.map((g) => {
                const titulo = g.vendor_name ?? 'Sin proveedor';
                return [
                  <span className="block min-w-0">
                    {g.advance_id ? (
                      <Link
                        to="/anticipos/$anticipoId/gastos/$gastoId"
                        params={{ anticipoId: g.advance_id, gastoId: g.id }}
                        className="font-semibold text-slate-900 hover:underline"
                      >
                        {titulo}
                      </Link>
                    ) : (
                      <span className="font-semibold text-slate-900">{titulo}</span>
                    )}
                    <span className="block text-slate-500">
                      {formatoFechaCalendario(g.invoice_date)}
                      {g.country && ` · ${g.country}`}
                    </span>
                  </span>,
                  <span className="text-slate-600">{etiqueta('documento', g.document_type)}</span>,
                  formatoDinero(g.total, g.currency),
                  <Seleccion
                    aria-label={`Deducibilidad de ${titulo}`}
                    className="w-auto"
                    value={g.deductibility ?? ''}
                    disabled={cambiar.isPending && cambiar.variables?.id === g.id}
                    onChange={(e) => cambiar.mutate({ id: g.id, deducibilidad: e.target.value as Deducibilidad })}
                  >
                    {DEDUCIBILIDADES.map((d) => (
                      <option key={d} value={d}>
                        {etiqueta('deducibilidad', d)}
                      </option>
                    ))}
                  </Seleccion>,
                ];
              })}
            />
          )
        }
      </EstadoConsulta>
    </Seccion>
  );
}
