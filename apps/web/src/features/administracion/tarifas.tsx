import { ApiError } from '@viaticos/client-api';
import {
  useCategorias,
  useCrearTarifa,
  useDesactivarTarifa,
  useGuardarZona,
  useImportarTarifas,
  useTarifas,
  useZonas,
} from '@viaticos/client-app';
import type { Tarifa, TipoPersonal, UnidadTarifa, ZonaViaje } from '@viaticos/contracts';
import { useRef, useState } from 'react';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Cargando, EstadoVacio, Insignia, Tarjeta } from '../../ui/superficies';

const TIPOS: TipoPersonal[] = ['administrative', 'operational'];
const UNIDADES: UnidadTarifa[] = ['per_day', 'per_night', 'per_trip'];
const lugares = (texto: string) =>
  texto
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Presupuesto de viaje: el destino del anticipo se busca entre los lugares de las zonas y el valor sale de las
 * tarifas de esa zona para el tipo de personal del viajero. No son topes: pedir otro valor exige justificación.
 */
export function TarifasViaje({ companiaId }: { companiaId: string }) {
  const zonas = useZonas(companiaId);
  if (zonas.isPending) return <Cargando />;
  if (zonas.isError) return <Alerta tono="peligro">{mensajeDeError(zonas.error)}</Alerta>;
  return (
    <div className="space-y-8">
      <Zonas companiaId={companiaId} zonas={zonas.data} />
      <Tarifas companiaId={companiaId} zonas={zonas.data} />
      <ImportarExcel companiaId={companiaId} />
    </div>
  );
}

// --- Zonas --------------------------------------------------------------------------------------

function Zonas({ companiaId, zonas }: { companiaId: string; zonas: ZonaViaje[] }) {
  const guardar = useGuardarZona(companiaId);
  const [editando, setEditando] = useState<ZonaViaje | 'nueva' | null>(zonas.length === 0 ? 'nueva' : null);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-700">Zonas</h2>
          <p className="text-sm text-slate-500">
            Ciudades o países (código ISO, p. ej. BR) que comparten tarifas. Si un destino coincide con varias zonas, gana la más específica.
          </p>
        </div>
        {editando === null && (
          <Boton variante="secundario" onClick={() => setEditando('nueva')}>
            Nueva zona
          </Boton>
        )}
      </div>
      {guardar.isError && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
      {editando && (
        <FormularioZona
          zona={editando === 'nueva' ? null : editando}
          cargando={guardar.isPending}
          alGuardar={(nombre, lista) =>
            guardar.mutate(
              { id: editando === 'nueva' ? undefined : editando.id, datos: { name: nombre, places: lista } },
              { onSuccess: () => setEditando(null) },
            )
          }
          alCancelar={() => setEditando(null)}
        />
      )}
      {zonas.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {zonas.map((z) => (
            <li key={z.id} className="flex flex-wrap items-start justify-between gap-2 p-4">
              <div className="min-w-0">
                <p className="font-medium">
                  {z.name} {!z.active && <Insignia>Inactiva</Insignia>}
                </p>
                <p className="text-sm text-slate-500">{z.places.join(', ') || 'Sin lugares'}</p>
              </div>
              <div className="flex gap-2">
                <Boton variante="fantasma" onClick={() => setEditando(z)}>
                  Editar
                </Boton>
                <Boton variante="fantasma" disabled={guardar.isPending} onClick={() => guardar.mutate({ id: z.id, datos: { active: !z.active } })}>
                  {z.active ? 'Desactivar' : 'Activar'}
                </Boton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FormularioZona({
  zona,
  cargando,
  alGuardar,
  alCancelar,
}: {
  zona: ZonaViaje | null;
  cargando: boolean;
  alGuardar: (nombre: string, lugares: string[]) => void;
  alCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(zona?.name ?? '');
  const [texto, setTexto] = useState(zona?.places.join(', ') ?? '');
  return (
    <Tarjeta className="grid gap-3 sm:grid-cols-[1fr_2fr]">
      <Campo etiqueta="Nombre de la zona">
        {(p) => <Entrada {...p} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Ciudades principales" />}
      </Campo>
      <Campo etiqueta="Lugares" ayuda="Separados por coma">
        {(p) => <Entrada {...p} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Bogotá, Medellín, Cali" />}
      </Campo>
      <div className="flex gap-2 sm:col-span-2">
        <Boton cargando={cargando} disabled={nombre.trim().length < 2} onClick={() => alGuardar(nombre.trim(), lugares(texto))}>
          Guardar zona
        </Boton>
        <Boton variante="fantasma" onClick={alCancelar}>
          Cancelar
        </Boton>
      </div>
    </Tarjeta>
  );
}

// --- Tarifas ------------------------------------------------------------------------------------

function Tarifas({ companiaId, zonas }: { companiaId: string; zonas: ZonaViaje[] }) {
  const tarifas = useTarifas(companiaId);
  const categorias = useCategorias(companiaId);
  const desactivar = useDesactivarTarifa(companiaId);
  const [zona, setZona] = useState('');
  const [nueva, setNueva] = useState(false);
  const nombreCategoria = (codigo: string) => categorias.data?.find((c) => c.code === codigo)?.name ?? codigo;
  const nombreZona = (id: string) => zonas.find((z) => z.id === id)?.name ?? '—';
  const visibles = (tarifas.data ?? []).filter((t) => !zona || t.zone_id === zona);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-700">Tarifas</h2>
        <div className="flex flex-wrap gap-2">
          <Seleccion aria-label="Filtrar por zona" className="w-auto" value={zona} onChange={(e) => setZona(e.target.value)}>
            <option value="">Todas las zonas</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Seleccion>
          {!nueva && zonas.length > 0 && (
            <Boton variante="secundario" onClick={() => setNueva(true)}>
              Nueva tarifa
            </Boton>
          )}
        </div>
      </div>
      {nueva && <FormularioTarifa companiaId={companiaId} zonas={zonas} zonaInicial={zona} alTerminar={() => setNueva(false)} />}
      {desactivar.isError && <Alerta tono="peligro">{mensajeDeError(desactivar.error)}</Alerta>}
      {tarifas.isPending ? (
        <Cargando />
      ) : tarifas.isError ? (
        <Alerta tono="peligro">{mensajeDeError(tarifas.error)}</Alerta>
      ) : visibles.length === 0 ? (
        <EstadoVacio titulo="No hay tarifas">{zonas.length ? 'Agréguelas una por una o cárguelas desde Excel.' : 'Cree primero una zona.'}</EstadoVacio>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Zona</th>
                <th className="px-4 py-2">Personal</th>
                <th className="px-4 py-2">Categoría</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="px-4 py-2">Vigencia</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((t) => (
                <FilaTarifa
                  key={t.id}
                  tarifa={t}
                  zona={nombreZona(t.zone_id)}
                  categoria={nombreCategoria(t.category_code)}
                  ocupado={desactivar.isPending && desactivar.variables === t.id}
                  alDesactivar={() => desactivar.mutate(t.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FilaTarifa({
  tarifa: t,
  zona,
  categoria,
  ocupado,
  alDesactivar,
}: {
  tarifa: Tarifa;
  zona: string;
  categoria: string;
  ocupado: boolean;
  alDesactivar: () => void;
}) {
  return (
    <tr>
      <td className="px-4 py-2">{zona}</td>
      <td className="px-4 py-2">{etiqueta('personal', t.staff_type)}</td>
      <td className="px-4 py-2">{categoria}</td>
      <td className="whitespace-nowrap px-4 py-2 text-right">
        {formatoDinero(t.amount, t.currency)} <span className="text-slate-500">{etiqueta('unidad', t.unit)}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
        {formatoFechaCalendario(t.valid_from)} – {t.valid_to ? formatoFechaCalendario(t.valid_to) : 'sin fin'}
      </td>
      <td className="px-4 py-2 text-right">
        <Boton variante="fantasma" cargando={ocupado} onClick={alDesactivar}>
          Desactivar
        </Boton>
      </td>
    </tr>
  );
}

function FormularioTarifa({
  companiaId,
  zonas,
  zonaInicial,
  alTerminar,
}: {
  companiaId: string;
  zonas: ZonaViaje[];
  zonaInicial: string;
  alTerminar: () => void;
}) {
  const categorias = useCategorias(companiaId);
  const crear = useCrearTarifa(companiaId);
  const [datos, setDatos] = useState({
    zone_id: zonaInicial || zonas[0]?.id || '',
    staff_type: 'administrative' as TipoPersonal,
    category_code: '',
    amount: '',
    currency: 'COP',
    unit: 'per_day' as UnidadTarifa,
    valid_from: new Date().toISOString().slice(0, 10),
    valid_to: '',
  });
  const cambiar = (cambios: Partial<typeof datos>) => setDatos((d) => ({ ...d, ...cambios }));
  const completo = datos.zone_id && datos.category_code && Number(datos.amount.replace(',', '.')) > 0 && datos.valid_from;

  return (
    <Tarjeta className="grid gap-3 sm:grid-cols-4">
      <Campo etiqueta="Zona">
        {(p) => (
          <Seleccion {...p} value={datos.zone_id} onChange={(e) => cambiar({ zone_id: e.target.value })}>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Seleccion>
        )}
      </Campo>
      <Campo etiqueta="Tipo de personal">
        {(p) => (
          <Seleccion {...p} value={datos.staff_type} onChange={(e) => cambiar({ staff_type: e.target.value as TipoPersonal })}>
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {etiqueta('personal', t)}
              </option>
            ))}
          </Seleccion>
        )}
      </Campo>
      <Campo etiqueta="Categoría">
        {(p) => (
          <Seleccion {...p} value={datos.category_code} onChange={(e) => cambiar({ category_code: e.target.value })}>
            <option value="">—</option>
            {(categorias.data ?? [])
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.emoji} {c.name}
                </option>
              ))}
          </Seleccion>
        )}
      </Campo>
      <Campo etiqueta="Unidad">
        {(p) => (
          <Seleccion {...p} value={datos.unit} onChange={(e) => cambiar({ unit: e.target.value as UnidadTarifa })}>
            {UNIDADES.map((u) => (
              <option key={u} value={u}>
                {etiqueta('unidad', u)}
              </option>
            ))}
          </Seleccion>
        )}
      </Campo>
      <Campo etiqueta="Valor">
        {(p) => <Entrada {...p} inputMode="decimal" value={datos.amount} onChange={(e) => cambiar({ amount: e.target.value })} />}
      </Campo>
      <Campo etiqueta="Moneda">
        {(p) => (
          <Entrada {...p} maxLength={3} className="uppercase" value={datos.currency} onChange={(e) => cambiar({ currency: e.target.value.toUpperCase() })} />
        )}
      </Campo>
      <Campo etiqueta="Desde">
        {(p) => <Entrada {...p} type="date" value={datos.valid_from} onChange={(e) => cambiar({ valid_from: e.target.value })} />}
      </Campo>
      <Campo etiqueta="Hasta" ayuda="Vacío = sin fin">
        {(p) => <Entrada {...p} type="date" value={datos.valid_to} onChange={(e) => cambiar({ valid_to: e.target.value })} />}
      </Campo>
      {crear.isError && (
        <div className="sm:col-span-4">
          <Alerta tono="peligro">{mensajeDeError(crear.error)}</Alerta>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-4">
        <Boton
          cargando={crear.isPending}
          disabled={!completo}
          onClick={() =>
            crear.mutate(
              { ...datos, amount: datos.amount.replace(/\./g, '').replace(',', '.'), valid_to: datos.valid_to || null },
              { onSuccess: alTerminar },
            )
          }
        >
          Guardar tarifa
        </Boton>
        <Boton variante="fantasma" onClick={alTerminar}>
          Cancelar
        </Boton>
      </div>
    </Tarjeta>
  );
}

// --- Carga desde Excel ----------------------------------------------------------------------------

type Problema = { row: number; field: string; issue: string };

function ImportarExcel({ companiaId }: { companiaId: string }) {
  const importar = useImportarTarifas(companiaId);
  const selector = useRef<HTMLInputElement>(null);
  const error = importar.error ? ApiError.desde(importar.error) : null;
  const problemas = (error?.detalles ?? []).filter((d): d is Problema => typeof d.row === 'number');

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold text-slate-700">Cargar tarifas desde Excel</h2>
        <p className="text-sm text-slate-500">
          Un .xlsx con estas columnas en la primera fila: <strong>Zona, Tipo_personal, Categoria, Valor, Moneda, Unidad, Desde, Hasta</strong>. Tipo de
          personal: administrativo u operativo. Unidad: día, noche o viaje. La categoría va por su código (p. ej. lodging). Si una fila tiene un
          problema, no se carga ninguna.
        </p>
      </div>
      <input
        ref={selector}
        type="file"
        className="hidden"
        aria-label="Archivo de tarifas"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (archivo) importar.mutate(archivo);
          e.target.value = '';
        }}
      />
      <Boton variante="secundario" cargando={importar.isPending} onClick={() => selector.current?.click()}>
        Elegir archivo y cargar
      </Boton>
      {importar.isSuccess && <Alerta tono="exito">Se cargaron {importar.data} tarifas.</Alerta>}
      {error && (
        <Alerta tono="peligro" titulo={error.message}>
          {problemas.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {problemas.slice(0, 50).map((p, i) => (
                <li key={i}>
                  Fila {p.row}, {p.field}: {p.issue}
                </li>
              ))}
            </ul>
          )}
        </Alerta>
      )}
    </section>
  );
}
