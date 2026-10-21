import { useCambiarConfiguracion, useConfiguracion } from '@viaticos/client-app';
import type { Configuracion } from '@viaticos/contracts';
import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { erroresDeCampo, mensajeDeError } from '../../lib/errores';
import { formatoMomento } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { cx } from '../../lib/cx';
import { AreaTexto, Campo, Entrada, Interruptor, Seleccion } from '../../ui/campos';
import { Seccion } from '../../ui/pagina';
import { Alerta, EstadoVacio, Esqueleto, Insignia } from '../../ui/superficies';

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

  const filas = useMemo(() => configuracion.data ?? [], [configuracion.data]);
  const porLlave = useMemo(() => new Map(filas.map((c) => [c.key, c])), [filas]);
  const cambiadas = Object.entries(borrador).filter(([llave, texto]) => {
    const c = porLlave.get(llave);
    return c && texto !== aTexto(c);
  });
  const visibles = filas.filter((c) => !buscar || `${c.key} ${c.description}`.toLowerCase().includes(buscar.toLowerCase()));
  const areas = [...new Set(visibles.map((c) => c.key.split('.')[0]!))];
  const errores = erroresDeCampo(guardar.error);

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

  if (configuracion.isPending) return <Esqueleto filas={8} />;
  if (configuracion.isError) return <Alerta tono="peligro">{mensajeDeError(configuracion.error)}</Alerta>;

  const deArea = (area: string) => visibles.filter((c) => c.key.startsWith(`${area}.`));
  const pendientesDe = (area: string) => cambiadas.filter(([llave]) => llave.startsWith(`${area}.`)).length;

  return (
    <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
      {/* El índice de áreas queda a la vista: hay más de 60 llaves y se llega a cada grupo de un salto. */}
      <nav aria-label="Áreas de la configuración" className="hidden lg:sticky lg:top-8 lg:block lg:self-start">
        <ul className="space-y-0.5">
          {areas.map((area) => (
            <li key={area}>
              <a
                href={`#area-${area}`}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              >
                <span className="min-w-0 flex-1 truncate">{AREAS[area] ?? area}</span>
                {pendientesDe(area) > 0 ? (
                  <span className="rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-900 tabular-nums">
                    {pendientesDe(area)}
                    <span className="sr-only"> sin guardar</span>
                  </span>
                ) : (
                  <span className="text-xs text-slate-500 tabular-nums">{deArea(area).length}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-10">
        <Campo etiqueta="Buscar una llave" className="max-w-sm">
          {(p) => (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <Entrada {...p} placeholder="Por ejemplo modelo o plantilla" className="pl-9" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            </div>
          )}
        </Campo>
        {errorLocal && <Alerta tono="peligro">{errorLocal}</Alerta>}
        {guardar.isError && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
        {guardar.isSuccess && cambiadas.length === 0 && <Alerta tono="exito">Configuración guardada. Ya está en uso.</Alerta>}
        {areas.length === 0 && <EstadoVacio titulo="Ninguna llave coincide con la búsqueda" icono={Search} />}
        {areas.map((area) => (
          <div key={area} id={`area-${area}`} className="scroll-mt-20 lg:scroll-mt-8">
            <Seccion titulo={AREAS[area] ?? area} contador={deArea(area).length}>
              <ul className="divide-y divide-slate-100">
                {deArea(area).map((c) => (
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
            </Seccion>
          </div>
        ))}

        {/* Lo pendiente se guarda desde abajo, siempre a la mano, y solo aparece cuando hay algo que guardar. */}
        {cambiadas.length > 0 && (
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:mx-0 sm:rounded-xl sm:border sm:shadow-lg">
            <p className="flex-1 text-sm font-semibold text-slate-900">
              {cambiadas.length === 1 ? '1 cambio sin guardar' : `${cambiadas.length} cambios sin guardar`}
            </p>
            <Boton variante="fantasma" onClick={() => setBorrador({})}>
              Descartar
            </Boton>
            <Boton cargando={guardar.isPending} onClick={enviar}>
              <Check aria-hidden />
              Guardar
            </Boton>
          </div>
        )}
      </div>
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
    <li className={cx('grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-6', cambiada && '-mx-3 rounded-lg bg-amber-50 px-3')}>
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
          {c.description}
          {cambiada && <Insignia tono="aviso">Sin guardar</Insignia>}
        </label>
        <p className="font-mono text-xs break-all text-slate-500">{c.key}</p>
        <p className="text-xs text-slate-500">Cambiado el {formatoMomento(c.updated_at)}</p>
      </div>
      <div className="space-y-1">
        {c.value_type === 'bool' ? (
          <Interruptor id={id} activo={texto === 'true'} alCambiar={(activo) => alCambiar(String(activo))} />
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
