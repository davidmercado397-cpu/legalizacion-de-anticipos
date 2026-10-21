import { useRevisarGasto } from '@viaticos/client-app';
import type { DecisionRevision, GastoDetalle } from '@viaticos/contracts';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { AreaTexto, Campo } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';

/** Contabilidad decide qué se acepta de un gasto con hallazgos. */
export function RevisionGasto({ gasto }: { gasto: GastoDetalle }) {
  const revisar = useRevisarGasto();
  const [nota, setNota] = useState('');
  const decidir = (decision: DecisionRevision) => revisar.mutate({ id: gasto.id, decision, nota: nota.trim() || null });
  return (
    <Tarjeta className="space-y-4">
      <h2 className="text-lg font-bold tracking-tight text-slate-900">Tu decisión sobre este gasto</h2>
      {gasto.suggested_non_reimbursable && (
        <p className="text-sm text-slate-600">
          Lo no permitido suma {formatoDinero(gasto.suggested_non_reimbursable, gasto.currency)} con su parte de impuestos.
        </p>
      )}
      <Campo etiqueta="Comentario" ayuda="Obligatorio si aceptas el gasto completo pese a la política.">
        {(p) => <AreaTexto {...p} value={nota} onChange={(e) => setNota(e.target.value)} rows={2} />}
      </Campo>
      <div className="flex flex-wrap gap-2">
        <Boton cargando={revisar.isPending} onClick={() => decidir('accept_without_blocked')}>
          Aceptar sin lo no permitido
        </Boton>
        <Boton variante="secundario" cargando={revisar.isPending} onClick={() => decidir('accept_full')}>
          Aceptar completo
        </Boton>
        <Boton variante="peligro" cargando={revisar.isPending} onClick={() => decidir('reject')}>
          Rechazar
        </Boton>
      </div>
      {revisar.isError && <Alerta tono="peligro">{mensajeDeError(revisar.error)}</Alerta>}
    </Tarjeta>
  );
}
