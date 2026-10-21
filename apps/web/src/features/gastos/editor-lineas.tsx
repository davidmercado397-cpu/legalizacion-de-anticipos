import { useConceptosBloqueados, useCorregirLinea } from '@viaticos/client-app';
import type { GastoDetalle } from '@viaticos/contracts';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero } from '../../lib/formato';
import { Seleccion } from '../../ui/campos';
import { Seccion } from '../../ui/pagina';
import { Alerta, Insignia } from '../../ui/superficies';
import { Tabla } from '../../ui/tabla';

/** Lo que dice cada línea y si su concepto está permitido; quien edita puede marcarlo. */
export function LineasGasto({ gasto, companiaId, editable }: { gasto: GastoDetalle; companiaId: string; editable: boolean }) {
  const conceptos = useConceptosBloqueados(companiaId);
  const corregir = useCorregirLinea();
  if (gasto.lines.length === 0) return null;
  const nombre = (codigo: string | null) => (codigo ? (conceptos.data?.find((c) => c.code === codigo)?.name ?? codigo) : null);
  return (
    <Seccion titulo="Líneas de la factura" contador={gasto.lines.length}>
      <Tabla
        columnas={['Descripción', { titulo: 'Valor', numerica: true }, 'Concepto']}
        claves={gasto.lines.map((l) => l.id)}
        filas={gasto.lines.map((l) => {
          const concepto = l.final_concept_code;
          return [
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{l.description}</p>
              {l.similar_concept_code && !concepto && <p className="text-slate-500">Se parece a {nombre(l.similar_concept_code)}</p>}
            </div>,
            <>
              {l.quantity && <span className="text-slate-500">{l.quantity} × </span>}
              {formatoDinero(l.amount, gasto.currency)}
            </>,
            editable ? (
              <Seleccion
                aria-label={`Concepto de ${l.description}`}
                className="w-auto"
                value={concepto ?? ''}
                disabled={corregir.isPending}
                onChange={(e) => corregir.mutate({ id: gasto.id, lineaId: l.id, concepto: e.target.value || null })}
              >
                <option value="">Permitido</option>
                {(conceptos.data ?? [])
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      No permitido: {c.name}
                    </option>
                  ))}
              </Seleccion>
            ) : concepto ? (
              <Insignia tono="peligro">{nombre(concepto)}</Insignia>
            ) : (
              <span className="text-slate-500">Permitido</span>
            ),
          ];
        })}
      />
      {corregir.isError && <Alerta tono="peligro">{mensajeDeError(corregir.error)}</Alerta>}
    </Seccion>
  );
}
