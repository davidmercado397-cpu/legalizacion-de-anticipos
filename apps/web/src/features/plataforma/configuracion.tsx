import { ApiError } from '@viaticos/client-api';
import { useCambiarConfiguracion, useConfiguracion } from '@viaticos/client-app';
import type { Configuracion } from '@viaticos/contracts';
import { useMemo, useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { formatoMomento } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { AreaTexto, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Cargando, Insignia } from '../../ui/superficies';

const AREAS: Record<string, string> = {
  ai: 'Lectura con IA (modelos y enrutamiento)',
  whatsapp: 'WhatsApp',
  operation: 'Operación',
  exchange: 'Tasas de cambio',
  legalization: 'Legalización',
  reconciliation: 'Conciliación bancaria',
  reports: 'Reportes',
  usage: 'Uso y plan',
  learning: 'Aprendizaje',
  image: 'Imágenes',
  fiscal: 'Fiscal',
  defaults: 'Valores para compañías nuevas',
};

const ESTRUCTURADOS = new Set(['json', 'list']);
/** El valor como lo edita la persona: JSON con sangría para listas y objetos, texto para lo demás. */
const aTexto = (c: Configuracion) => (ESTRUCTURADOS.has(c.value_type) ? JSON.stringify(c.value, null, 2) : String(c.value ?? ''));

function aValor(c: Configuracion, texto: string): unknown {
  switch (c.value_type) {
    case 'bool':
      return texto === 'true';
    case 'int':
      return Number.parseInt(texto, 10);
    case 'decimal':
      return Number(texto.replace(',', '.'));
    case 'json':
    case 'list':
      return JSON.parse(texto);
    default:
      return texto;
  }
}

/**
 * Configuración del sistema (solo el superadmin de NextByte): cada llave trae su tipo, rango y descripción; la API la
 * valida y la aplica sin reiniciar. Aquí se cambian, entre otras, los modelos de IA (decisión 8.6).
 */
export function ConfiguracionSistema() {
  const configuracion = useConfiguracion();
  const guardar = useCambiarConfiguracion();
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [buscar, setBuscar] = useState('');
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  const filas = configuracion.data ?? [];
  const porLlave = useMemo(() => new Map(filas.map((c) => [c.key, c])), [filas]);
  const cambiadas = Object.entries(borrador).filter(([llave, texto]) => {
    const c = porLlave.get(llave);
    return c && texto !== aTexto(c);
  });
  const visibles = filas.filter((c) => !buscar || `${c.key} ${c.description}`.toLowerCase().includes(buscar.toLowerCase()));
  const areas = [...new Set(visibles.map((c) => c.key.split('.')[0]!))];
  const errores = guardar.error ? ApiError.desde(guardar.error).erroresCampo : {};

  const enviar = () => {
    setErrorLocal(null);
    const valores: Record<string, unknown> = {};
    for (const [llave, texto] of cambiadas) {
      try {
        valores[llave] = aValor(porLlave.get(llave)!, texto);
      } catch {
        setErrorLocal(`«${llave}» no es un JSON válido.`);
        return;
      }
    }
    guardar.mutate(valores, { onSuccess: () => setBorrador({}) });
  };

  if (configuracion.isPending) return <Cargando />;
  if (configuracion.isError) return <Alerta tono="peligro">{mensajeDeError(configuracion.error)}</Alerta>;

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-[5] flex flex-wrap items-center justify-between gap-2 bg-white/95 py-2 backdrop-blur">
        <Entrada aria-label="Buscar llave" placeholder="Buscar (p. ej. modelo, plantilla)" className="max-w-xs" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <div className="flex items-center gap-2">
          {cambiadas.length > 0 && (
            <Boton variante="fantasma" onClick={() => setBorrador({})}>
              Descartar
            </Boton>
          )}
          <Boton disabled={cambiadas.length === 0} cargando={guardar.isPending} onClick={enviar}>
            Guardar {cambiadas.length > 0 ? `${cambiadas.length} ${cambiadas.length === 1 ? 'cambio' : 'cambios'}` : 'cambios'}
          </Boton>
        </div>
      </div>
      {errorLocal && <Alerta tono="peligro">{errorLocal}</Alerta>}
      {guardar.isError && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
      {guardar.isSuccess && cambiadas.length === 0 && <Alerta tono="exito">Configuración guardada. Ya está en uso.</Alerta>}
      {areas.map((area) => (
        <section key={area} className="space-y-2">
          <h2 className="font-semibold text-slate-700">{AREAS[area] ?? area}</h2>
          <ul className="divide-y divide-slate-200 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {visibles
              .filter((c) => c.key.startsWith(`${area}.`))
              .map((c) => (
                <Llave
                  key={c.key}
                  config={c}
                  texto={borrador[c.key] ?? aTexto(c)}
                  cambiada={c.key in borrador && borrador[c.key] !== aTexto(c)}
                  error={errores[c.key]?.join(' ')}
                  alCambiar={(texto) => setBorrador((b) => ({ ...b, [c.key]: texto }))}
                />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Llave({
  config: c,
  texto,
  cambiada,
  error,
  alCambiar,
}: {
  config: Configuracion;
  texto: string;
  cambiada: boolean;
  error: string | undefined;
  alCambiar: (texto: string) => void;
}) {
  const r = c.constraints as { min?: number; max?: number; max_length?: number; options?: string[] };
  const id = `llave-${c.key}`;
  return (
    <li className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-700">
          {c.key} {cambiada && <Insignia tono="aviso">Sin guardar</Insignia>}
        </label>
        <p className="text-sm text-slate-600">{c.description}</p>
        <p className="text-xs text-slate-400">Cambiado {formatoMomento(c.updated_at)}</p>
      </div>
      <div className="space-y-1">
        {c.value_type === 'bool' ? (
          <label className="flex items-center gap-2 text-sm">
            <input id={id} type="checkbox" checked={texto === 'true'} onChange={(e) => alCambiar(String(e.target.checked))} />
            {texto === 'true' ? 'Activado' : 'Desactivado'}
          </label>
        ) : r.options ? (
          <Seleccion id={id} value={texto} onChange={(e) => alCambiar(e.target.value)}>
            {r.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Seleccion>
        ) : ESTRUCTURADOS.has(c.value_type) ? (
          <AreaTexto
            id={id}
            className="font-mono text-xs"
            rows={Math.min(Math.max(texto.split('\n').length, 2), 12)}
            value={texto}
            spellCheck={false}
            onChange={(e) => alCambiar(e.target.value)}
          />
        ) : (
          <Entrada
            id={id}
            value={texto}
            onChange={(e) => alCambiar(e.target.value)}
            {...(c.value_type === 'int' || c.value_type === 'decimal'
              ? { type: 'number', min: r.min, max: r.max, step: c.value_type === 'int' ? 1 : 'any', inputMode: 'decimal' as const }
              : { maxLength: r.max_length })}
          />
        )}
        {(r.min !== undefined || r.max !== undefined) && (
          <p className="text-xs text-slate-500">
            Entre {r.min ?? '—'} y {r.max ?? '—'}
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </li>
  );
}
