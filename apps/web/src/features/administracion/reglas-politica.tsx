import { useConfigurarReglas, useReglas } from '@viaticos/client-app';
import type { ReglaPolitica, ReglaPoliticaNueva } from '@viaticos/contracts';
import { useEffect, useState } from 'react';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Cargando, Insignia } from '../../ui/superficies';

const ACCIONES = ['warn', 'require_justification', 'block'] as const;

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
  const [borrador, setBorrador] = useState<ReglaPolitica[]>([]);
  useEffect(() => setBorrador(reglas.data ?? []), [reglas.data]);

  if (reglas.isPending) return <Cargando />;
  if (reglas.isError) return <Alerta tono="peligro">{mensajeDeError(reglas.error)}</Alerta>;

  const cambiar = (i: number, cambios: Partial<ReglaPolitica>) => setBorrador((b) => b.map((r, j) => (j === i ? { ...r, ...cambios } : r)));

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-200 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {borrador.map((regla, i) => (
          <li key={regla.rule_type} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  {etiqueta('regla', regla.rule_type)} {regla.customized && <Insignia tono="info">Personalizada</Insignia>}
                </p>
                <p className="text-sm text-slate-500">{regla.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={regla.active} onChange={(e) => cambiar(i, { active: e.target.checked })} />
                  Activa
                </label>
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
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.entries(regla.params).map(([clave, valor]) => (
                  <label key={clave} className="text-sm">
                    <span className="text-slate-500">{clave}</span>
                    <Entrada
                      value={aTexto(valor)}
                      onChange={(e) => cambiar(i, { params: { ...regla.params, [clave]: desdeTexto(valor, e.target.value) } })}
                    />
                  </label>
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
