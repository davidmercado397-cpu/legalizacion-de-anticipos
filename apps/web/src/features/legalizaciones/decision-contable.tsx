import { useAprobarLegalizacion, useDecidirSoporte, useDevolverLegalizacion } from '@viaticos/client-app';
import type { LegalizacionResponse, SoporteResponse } from '@viaticos/contracts';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { AreaTexto, Campo } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';

/** Decisión de contabilidad sobre un soporte con alertas (ej. factura no a nombre de la empresa). */
export function DecisionSoporte({ legalizacionId, soporte }: { legalizacionId: string; soporte: SoporteResponse }) {
  const decidir = useDecidirSoporte();
  const [comentario, setComentario] = useState(soporte.decision?.comentario ?? '');
  const [error, setError] = useState<string>();

  const resolver = (aplica: boolean) => {
    if (!aplica && comentario.trim().length < 3) {
      setError('Explique por qué no aplica');
      return;
    }
    setError(undefined);
    decidir.mutate({ id: legalizacionId, soporteId: soporte.id, datos: { aplica, comentario: comentario.trim() || undefined } });
  };

  return (
    <div className="w-full space-y-2 rounded-lg bg-amber-50 p-3">
      <Campo etiqueta="Comentario de contabilidad" error={error}>
        {(a11y) => <AreaTexto {...a11y} rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} error={error} />}
      </Campo>
      {decidir.isError && <Alerta tono="peligro">{mensajeDeError(decidir.error)}</Alerta>}
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="peligro" cargando={decidir.isPending && decidir.variables?.datos.aplica === false} onClick={() => resolver(false)}>
          No aplica
        </Boton>
        <Boton cargando={decidir.isPending && decidir.variables?.datos.aplica === true} onClick={() => resolver(true)}>
          Aplica
        </Boton>
      </div>
    </div>
  );
}

export function CierreContable({ legalizacion }: { legalizacion: LegalizacionResponse }) {
  const aprobar = useAprobarLegalizacion();
  const devolver = useDevolverLegalizacion();
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string>();
  const pendientes = legalizacion.soportes.filter((s) => s.requiereDecision && !s.decision).length;
  const fallo = aprobar.error ?? devolver.error;

  return (
    <Tarjeta className="space-y-3 ring-2 ring-marca-600">
      <h2 className="text-lg font-semibold">Revisión contable</h2>
      {pendientes > 0 ? (
        <Alerta tono="aviso">Falta decidir {pendientes} soporte(s) con alertas antes de aprobar.</Alerta>
      ) : (
        <p className="text-sm text-slate-600">Todos los soportes con alertas tienen decisión.</p>
      )}
      <Campo etiqueta="Comentario para el viajero (obligatorio para devolver)" error={error}>
        {(a11y) => <AreaTexto {...a11y} rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} error={error} />}
      </Campo>
      {fallo && <Alerta tono="peligro">{mensajeDeError(fallo)}</Alerta>}
      <div className="flex flex-wrap justify-end gap-2">
        <Boton
          variante="secundario"
          cargando={devolver.isPending}
          onClick={() => {
            if (comentario.trim().length < 5) return setError('Explique qué debe corregir (mínimo 5 caracteres)');
            setError(undefined);
            devolver.mutate({ id: legalizacion.id, comentario: comentario.trim() });
          }}
        >
          Devolver al viajero
        </Boton>
        <Boton disabled={pendientes > 0} cargando={aprobar.isPending} onClick={() => aprobar.mutate(legalizacion.id)}>
          Aprobar legalización
        </Boton>
      </div>
    </Tarjeta>
  );
}
