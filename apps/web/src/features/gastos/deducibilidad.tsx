import { useCambiarDeducibilidad, useDesgloseDeducibilidad } from '@viaticos/client-app';
import type { Deducibilidad, GastoDetalle } from '@viaticos/contracts';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero } from '../../lib/formato';
import { Seleccion } from '../../ui/campos';
import { Seccion } from '../../ui/pagina';
import { Alerta } from '../../ui/superficies';

export const DEDUCIBILIDADES: Deducibilidad[] = ['deductible', 'non_deductible', 'requires_support_document', 'requires_review'];

const FILAS = [
  ['deductible_base', 'Base deducible'],
  ['non_deductible_base', 'Base no deducible'],
  ['vat_creditable', 'IVA descontable'],
  ['vat_non_creditable', 'IVA no descontable'],
  ['consumption_tax', 'Impuesto al consumo (INC)'],
  ['other_taxes', 'Otros impuestos'],
  ['tip', 'Propina'],
  ['employee_assumed', 'Lo asume el empleado'],
] as const;

/** Sugerencia por tipo de soporte y desglose por línea; el criterio tributario lo define contabilidad. */
export function TarjetaDeducibilidad({ gasto }: { gasto: GastoDetalle }) {
  const desglose = useDesgloseDeducibilidad(gasto.id, gasto.status === 'confirmed');
  const cambiar = useCambiarDeducibilidad();
  return (
    <Seccion
      titulo="Deducibilidad"
      acciones={
        <Seleccion
          aria-label="Deducibilidad"
          className="w-auto"
          value={gasto.deductibility ?? ''}
          disabled={cambiar.isPending}
          onChange={(e) => cambiar.mutate({ id: gasto.id, deducibilidad: e.target.value as Deducibilidad })}
        >
          {!gasto.deductibility && <option value="">—</option>}
          {DEDUCIBILIDADES.map((d) => (
            <option key={d} value={d}>
              {etiqueta('deducibilidad', d)}
            </option>
          ))}
        </Seleccion>
      }
    >
      {desglose.data && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {FILAS.filter(([campo]) => Number(desglose.data[campo]) !== 0).map(([campo, nombre]) => (
            <div key={campo} className="contents">
              <dt className="text-slate-500">{nombre}</dt>
              <dd className="text-right font-medium tabular-nums">{formatoDinero(desglose.data[campo], gasto.currency)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-slate-500">Es una sugerencia por el tipo de soporte; si la cambias, la reevaluación no la vuelve a tocar.</p>
      {(cambiar.isError || desglose.isError) && <Alerta tono="peligro">{mensajeDeError(cambiar.error ?? desglose.error)}</Alerta>}
    </Seccion>
  );
}
