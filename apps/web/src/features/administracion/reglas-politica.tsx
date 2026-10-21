import { useConfigurarReglas, useReglas } from '@viaticos/client-app';
import type { ReglaPolitica, ReglaPoliticaNueva } from '@viaticos/contracts';
import { useState } from 'react';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Interruptor, Seleccion } from '../../ui/campos';
import { Alerta, Esqueleto, Insignia } from '../../ui/superficies';

const ACCIONES = ['warn', 'require_justification', 'review', 'block'] as const;

/** Parámetros simples (números y textos); las listas se muestran separadas por comas. */
const aTexto = (valor: unknown) => (Array.isArray(valor) ? valor.join(', ') : String(valor ?? ''));
function desdeTexto(original: unknown, texto: string): unknown {
  if (Array.isArray(original)) return texto.split(',').map((t) => t.trim()).filter(Boolean);
  if (typeof original === 'number') return texto.trim() === '' ? null : Number(texto.replace(',', '.'));
  return texto;
}

export function ReglasPolitica({ companiaId }: { companiaId: string }) {
  const reglas = useReglas(companiaId);
  const guardar = useConfigurarReglas(companiaId);
  if (reglas.isPending) return <Esqueleto filas={6} />;
  if (reglas.isError) return <Alerta tono="peligro">{mensajeDeError(reglas.error)}</Alerta>;
  // El borrador nace de lo guardado; cuando llega una versión nueva (p. ej. tras guardar) el editor empieza de ella.
  return <EditorReglas key={reglas.dataUpdatedAt} reglas={reglas.data} guardar={guardar} />;
}

function EditorReglas({ reglas, guardar }: { reglas: ReglaPolitica[]; guardar: ReturnType<typeof useConfigurarReglas> }) {
  const [borrador, setBorrador] = useState<ReglaPolitica[]>(reglas);

  const cambiar = (i: number, cambios: Partial<ReglaPolitica>) => setBorrador((b) => b.map((r, j) => (j === i ? { ...r, ...cambios } : r)));

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-slate-100">
        {borrador.map((regla, i) => (
          <li key={regla.rule_type} className="space-y-3 py-5 first:pt-0">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1 basis-72">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                  {etiqueta('regla', regla.rule_type)} {regla.customized && <Insignia tono="info">Personalizada</Insignia>}
                </p>
                <p className="text-sm text-slate-600">{regla.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Interruptor
                  aria-label={`${etiqueta('regla', regla.rule_type)} activa`}
                  activo={regla.active}
                  alCambiar={(activa) => cambiar(i, { active: activa })}
                  textos={['Inactiva', 'Activa']}
                />
                <Seleccion
                  aria-label={`Acción de ${etiqueta('regla', regla.rule_type)}`}
                  className="w-auto"
                  value={regla.action}
                  onChange={(e) => cambiar(i, { action: e.target.value as ReglaPolitica['action'] })}
                >
                  {ACCIONES.map((a) => (
                    <option key={a} value={a}>
                      {etiqueta('accion', a)}
                    </option>
                  ))}
                </Seleccion>
              </div>
            </div>
            {Object.keys(regla.params).length > 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                {Object.entries(regla.params).map(([clave, valor]) => (
                  <Campo key={clave} etiqueta={etiqueta('parametro', clave)}>
                    {(p) => (
                      <Entrada
                        {...p}
                        value={aTexto(valor)}
                        onChange={(e) => cambiar(i, { params: { ...regla.params, [clave]: desdeTexto(valor, e.target.value) } })}
                      />
                    )}
                  </Campo>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {guardar.isError && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
      {guardar.isSuccess && <Alerta tono="exito">Política guardada. Se aplica a los gastos nuevos y a los que no se han confirmado.</Alerta>}
      <Boton
        cargando={guardar.isPending}
        onClick={() =>
          guardar.mutate(
            borrador.map(({ rule_type, action, params, active }): ReglaPoliticaNueva => ({ rule_type, action, params, active })),
          )
        }
      >
        Guardar política
      </Boton>
    </div>
  );
}
