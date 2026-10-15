import { useAprobarSolicitud, useRechazarSolicitud } from '@viaticos/client-app';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { AreaTexto, Campo } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';

/** Acciones del aprobador del turno actual. El rechazo exige comentario (regla del dominio). */
export function PanelDecision({ solicitudId }: { solicitudId: string }) {
  const [comentario, setComentario] = useState('');
  const [errorComentario, setErrorComentario] = useState<string>();
  const aprobar = useAprobarSolicitud();
  const rechazar = useRechazarSolicitud();
  const error = aprobar.error ?? rechazar.error;
  const ocupado = aprobar.isPending || rechazar.isPending;

  const alRechazar = () => {
    if (comentario.trim().length < 5) {
      setErrorComentario('Explique el motivo del rechazo (mínimo 5 caracteres)');
      return;
    }
    setErrorComentario(undefined);
    rechazar.mutate({ id: solicitudId, comentario: comentario.trim() });
  };

  return (
    <Tarjeta className="space-y-3 ring-2 ring-marca-600">
      <h2 className="text-lg font-semibold">Su decisión</h2>
      <Campo etiqueta="Comentario" error={errorComentario} ayuda="Opcional para aprobar, obligatorio para rechazar.">
        {(a11y) => (
          <AreaTexto {...a11y} value={comentario} onChange={(e) => setComentario(e.target.value)} error={errorComentario} />
        )}
      </Campo>
      {error && <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>}
      <div className="flex flex-wrap justify-end gap-3">
        <Boton variante="peligro" onClick={alRechazar} cargando={rechazar.isPending} disabled={ocupado}>
          Rechazar
        </Boton>
        <Boton
          onClick={() => aprobar.mutate({ id: solicitudId, comentario: comentario.trim() || undefined })}
          cargando={aprobar.isPending}
          disabled={ocupado}
        >
          Aprobar
        </Boton>
      </div>
    </Tarjeta>
  );
}
