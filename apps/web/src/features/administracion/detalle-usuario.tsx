import { useAccionSuplencia, useAccionWhatsApp, useSuplencias } from '@viaticos/client-app';
import type { Empleado } from '@viaticos/contracts';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { formatoMomento } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Insignia } from '../../ui/superficies';

export const ESTADO_WHATSAPP = {
  none: { texto: 'Sin vincular', tono: 'neutro' },
  pending: { texto: 'Bienvenida enviada, falta que confirme', tono: 'aviso' },
  active: { texto: 'Vinculado', tono: 'exito' },
} as const;

/** Quienes aprueban solicitudes pueden tener suplentes. */
export const tieneSuplentes = (empleado: Empleado) => empleado.role === 'approver' || empleado.role === 'management';

/** El WhatsApp del usuario: su estado de vinculación y cómo vincularlo o desvincularlo. */
export function WhatsApp({ empleado: e }: { empleado: Empleado }) {
  const accion = useAccionWhatsApp(e.id);
  const estado = ESTADO_WHATSAPP[e.wa_link_status];
  const codigo = accion.data;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold text-slate-900">WhatsApp</h3>
      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        {e.phone ?? 'Sin celular'}
        <Insignia tono={estado.tono}>{estado.texto}</Insignia>
        {e.wa_profile_name && <span>· {e.wa_profile_name}</span>}
      </p>
      {e.privacy_accepted_at && <p className="text-xs text-slate-500">Aceptó el aviso de privacidad el {formatoMomento(e.privacy_accepted_at)}.</p>}
      <div className="flex flex-wrap gap-2">
        {e.phone && e.active && e.wa_link_status !== 'active' && (
          <Boton variante="secundario" tamano="pequeno" cargando={accion.isPending && accion.variables === 'bienvenida'} onClick={() => accion.mutate('bienvenida')}>
            Enviar bienvenida
          </Boton>
        )}
        {e.active && e.wa_link_status !== 'active' && (
          <Boton variante="secundario" tamano="pequeno" cargando={accion.isPending && accion.variables === 'codigo'} onClick={() => accion.mutate('codigo')}>
            Código para vincular
          </Boton>
        )}
        {e.wa_link_status !== 'none' && (
          <Boton variante="secundario" tamano="pequeno" cargando={accion.isPending && accion.variables === 'desvincular'} onClick={() => accion.mutate('desvincular')}>
            Desvincular
          </Boton>
        )}
        {!e.active && (e.phone || e.wa_link_status !== 'none') && (
          <Boton
            variante="secundario"
            tamano="pequeno"
            className="text-red-700"
            cargando={accion.isPending && accion.variables === 'borrar_contacto'}
            onClick={() => accion.mutate('borrar_contacto')}
          >
            Borrar celular y WhatsApp
          </Boton>
        )}
      </div>
      {accion.isSuccess && accion.variables === 'bienvenida' && <Alerta tono="exito">Bienvenida enviada. El usuario debe responder «Sí, soy yo».</Alerta>}
      {codigo && (
        <Alerta tono="info" titulo={`Código: ${codigo.code}`}>
          {codigo.instructions.replace(/\.?$/, '.')} Vence en {codigo.expires_in_minutes} minutos.
        </Alerta>
      )}
      {accion.isError && <Alerta tono="peligro">{mensajeDeError(accion.error)}</Alerta>}
    </section>
  );
}

const ahora = () => new Date().toISOString().slice(0, 16);

/** Quien aprueba puede dejar un suplente mientras no está. */
export function Suplentes({ empleado, aprobadores }: { empleado: Empleado; aprobadores: Empleado[] }) {
  const suplencias = useSuplencias(empleado.id);
  const accion = useAccionSuplencia(empleado.id);
  const candidatos = aprobadores.filter((a) => a.role === 'approver' && a.active && a.id !== empleado.id);
  const [suplente, setSuplente] = useState('');
  const [desde, setDesde] = useState(ahora);
  const [hasta, setHasta] = useState('');
  const nombre = (id: string) => aprobadores.find((a) => a.id === id)?.full_name ?? 'Usuario';
  const vigentes = (suplencias.data ?? []).filter((s) => !s.revoked_at && new Date(s.ends_at) > new Date());

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold text-slate-900">Suplentes</h3>
      <p className="text-sm text-slate-600">Mientras dure la suplencia, el suplente aprueba lo que le llega a {empleado.full_name}.</p>
      {vigentes.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {vigentes.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{nombre(s.delegate_id)}</span> · {formatoMomento(s.starts_at)} – {formatoMomento(s.ends_at)}
              </span>
              <Boton
                variante="secundario"
                tamano="pequeno"
                cargando={accion.isPending && accion.variables?.tipo === 'revocar' && accion.variables.id === s.id}
                onClick={() => accion.mutate({ tipo: 'revocar', id: s.id })}
              >
                Terminar
              </Boton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Sin suplentes vigentes.</p>
      )}
      {candidatos.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
          <Campo etiqueta="Suplente" className="sm:col-span-2">
            {(p) => (
              <Seleccion {...p} value={suplente} onChange={(ev) => setSuplente(ev.target.value)}>
                <option value="">—</option>
                {candidatos.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                  </option>
                ))}
              </Seleccion>
            )}
          </Campo>
          <Campo etiqueta="Desde">{(p) => <Entrada {...p} type="datetime-local" value={desde} onChange={(ev) => setDesde(ev.target.value)} />}</Campo>
          <Campo etiqueta="Hasta">{(p) => <Entrada {...p} type="datetime-local" value={hasta} onChange={(ev) => setHasta(ev.target.value)} />}</Campo>
          <div className="sm:col-span-2">
            <Boton
              variante="secundario"
              disabled={!suplente || !desde || !hasta}
              cargando={accion.isPending && accion.variables?.tipo === 'crear'}
              onClick={() =>
                accion.mutate(
                  {
                    tipo: 'crear',
                    datos: { delegate_id: suplente, starts_at: new Date(desde).toISOString(), ends_at: new Date(hasta).toISOString() },
                  },
                  { onSuccess: () => setSuplente('') },
                )
              }
            >
              Nombrar suplente
            </Boton>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No hay otros aprobadores activos para nombrar como suplentes.</p>
      )}
      {(accion.isError || suplencias.isError) && <Alerta tono="peligro">{mensajeDeError(accion.error ?? suplencias.error)}</Alerta>}
    </section>
  );
}
