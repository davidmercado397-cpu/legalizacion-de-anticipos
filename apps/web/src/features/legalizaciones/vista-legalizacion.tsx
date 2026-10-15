import { Link } from '@tanstack/react-router';
import { useEliminarSoporte, useEnviarLegalizacion } from '@viaticos/client-app';
import type { LegalizacionResponse } from '@viaticos/contracts';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { formatoFechaCalendario } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Alerta, EstadoVacio, Tarjeta } from '../../ui/superficies';
import { HistorialLegalizacion, InsigniaEstadoLegalizacion, ResumenSaldo, TarjetaSoporte } from './componentes';
import { CierreContable, DecisionSoporte } from './decision-contable';
import { FormularioReciboCaja } from './formulario-recibo';
import { SubirFactura } from './subir-factura';

export function VistaLegalizacion({ legalizacion: l, modo }: { legalizacion: LegalizacionResponse; modo: 'viajero' | 'contabilidad' }) {
  const eliminar = useEliminarSoporte();
  const enviar = useEnviarLegalizacion();
  const [conRecibo, setConRecibo] = useState(false);
  const devolucion = [...l.historial].reverse().find((h) => h.tipo === 'DEVUELTA');
  const editable = modo === 'viajero' && l.editable;
  const listos = l.soportes.length > 0 && l.soportes.every((s) => s.estado === 'CONFIRMADO');
  const fallo = eliminar.error ?? enviar.error;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Legalización del anticipo</h1>
          <p className="text-sm text-slate-600">
            {l.viajeroNombre} · viaje del {formatoFechaCalendario(l.viaje.inicio)} al {formatoFechaCalendario(l.viaje.fin)}
          </p>
        </div>
        <InsigniaEstadoLegalizacion estado={l.estado} />
      </div>

      {l.estado === 'DEVUELTA' && devolucion && (
        <Alerta tono="peligro" titulo={`Contabilidad la devolvió (${devolucion.usuarioNombre})`}>
          {devolucion.comentario}
        </Alerta>
      )}
      {l.estado === 'EN_REVISION' && modo === 'viajero' && <Alerta tono="info">Enviada a contabilidad. Le avisaremos si necesita corregir algo.</Alerta>}

      <ResumenSaldo legalizacion={l} />

      {editable && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SubirFactura legalizacionId={l.id} />
          {conRecibo ? (
            <FormularioReciboCaja legalizacionId={l.id} moneda={l.montoAnticipo.moneda} alTerminar={() => setConRecibo(false)} />
          ) : (
            <Tarjeta className="flex flex-col justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">¿Le dieron factura?</h2>
                <p className="text-sm text-slate-600">
                  Si fue una compra informal (taxi, vendedor ambulante), regístrela con un recibo de caja a nombre de proveedores varios (222).
                </p>
              </div>
              <Boton variante="secundario" onClick={() => setConRecibo(true)}>
                Registrar recibo de caja
              </Boton>
            </Tarjeta>
          )}
        </div>
      )}

      <section className="space-y-3" aria-label="Soportes">
        <h2 className="text-lg font-semibold">Soportes ({l.soportes.length})</h2>
        {l.soportes.length === 0 ? (
          <EstadoVacio titulo="Aún no hay facturas">Tome una foto de cada factura apenas la reciba.</EstadoVacio>
        ) : (
          l.soportes.map((s) => (
            <TarjetaSoporte
              key={s.id}
              legalizacion={l}
              soporte={s}
              acciones={
                <>
                  {editable && s.tipo === 'FACTURA' && s.estado !== 'PROCESANDO' && (
                    <Link
                      to="/legalizaciones/$legalizacionId/soportes/$soporteId"
                      params={{ legalizacionId: l.id, soporteId: s.id }}
                      className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-marca-700 ring-1 ring-marca-600 hover:bg-marca-50"
                    >
                      {s.estado === 'POR_CONFIRMAR' ? 'Confirmar datos' : 'Editar'}
                    </Link>
                  )}
                  {editable && (
                    <Boton
                      variante="fantasma"
                      className="text-red-700"
                      cargando={eliminar.isPending && eliminar.variables?.soporteId === s.id}
                      onClick={() => window.confirm('¿Eliminar este soporte?') && eliminar.mutate({ id: l.id, soporteId: s.id })}
                    >
                      Eliminar
                    </Boton>
                  )}
                  {modo === 'contabilidad' && l.estado === 'EN_REVISION' && s.requiereDecision && (
                    <DecisionSoporte legalizacionId={l.id} soporte={s} />
                  )}
                </>
              }
            />
          ))
        )}
      </section>

      {fallo && <Alerta tono="peligro">{mensajeDeError(fallo)}</Alerta>}

      {editable && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!listos && l.soportes.length > 0 && <p className="text-sm text-slate-600">Confirme los datos de todas las facturas para poder enviar.</p>}
          <Boton disabled={!listos} cargando={enviar.isPending} onClick={() => enviar.mutate(l.id)}>
            Enviar a contabilidad
          </Boton>
        </div>
      )}

      {modo === 'contabilidad' && l.estado === 'EN_REVISION' && <CierreContable legalizacion={l} />}

      {l.historial.length > 0 && (
        <Tarjeta className="space-y-2">
          <h2 className="font-semibold">Historial</h2>
          <HistorialLegalizacion historial={l.historial} />
        </Tarjeta>
      )}
    </div>
  );
}
