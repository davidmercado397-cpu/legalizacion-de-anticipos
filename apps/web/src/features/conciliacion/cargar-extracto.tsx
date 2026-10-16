import { useNavigate } from '@tanstack/react-router';
import { useCargarExtracto, useSesion, useVistaPreviaExtracto } from '@viaticos/client-app';
import { FORMATOS_FECHA_EXTRACTO, type PerfilExtractoDto, type VistaPreviaExtractoResponse } from '@viaticos/contracts';
import { useRef, useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Insignia, Tarjeta } from '../../ui/superficies';

const letra = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);

/**
 * Carga del extracto de la tarjeta: el sistema propone cómo leer el archivo (cualquier banco),
 * la persona lo revisa con la vista previa y luego se cruza con las facturas.
 */
export function CargarExtracto({ legalizacionId }: { legalizacionId: string }) {
  const navigate = useNavigate();
  const esContabilidad = useSesion((s) => s.usuario?.roles.includes('CONTABILIDAD') ?? false);
  const previa = useVistaPreviaExtracto();
  const cargar = useCargarExtracto();
  const selector = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [moneda, setMoneda] = useState('COP');
  const [ultimos4, setUltimos4] = useState('');
  const [perfil, setPerfil] = useState<PerfilExtractoDto | null>(null);
  const [guardarComo, setGuardarComo] = useState('');
  const [cambiado, setCambiado] = useState(false);
  const datos = previa.data;

  const leer = (conPerfil?: PerfilExtractoDto) => {
    if (!archivo) return;
    previa.mutate(
      { archivo: { contenido: archivo, nombre: archivo.name }, moneda, ...(conPerfil && { perfil: conPerfil }) },
      {
        onSuccess: (r) => {
          setPerfil(r.perfil);
          setCambiado(false);
        },
      },
    );
  };

  const cambiar = (cambio: (p: PerfilExtractoDto) => PerfilExtractoDto) => {
    setPerfil((p) => (p ? cambio(p) : p));
    setCambiado(true);
  };

  const enviar = () => {
    if (!archivo || !perfil) return;
    cargar.mutate(
      {
        datos: { legalizacionId, perfil, ...(ultimos4 && { ultimos4 }), ...(guardarComo.trim() && { guardarPerfilComo: guardarComo.trim() }) },
        archivo: { contenido: archivo, nombre: archivo.name },
      },
      { onSuccess: (e) => navigate({ to: '/conciliacion/$extractoId', params: { extractoId: e.id } }) },
    );
  };

  const ultimos4Invalidos = ultimos4 !== '' && !/^\d{4}$/.test(ultimos4);

  return (
    <div className="space-y-4">
      <Tarjeta className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">1. Archivo del extracto</h2>
          <p className="text-sm text-slate-600">
            Descárguelo desde la banca en línea como Excel (.xlsx) o CSV/TXT. Sirve cualquier banco: el sistema reconoce las columnas y usted las revisa.
          </p>
        </div>
        <input
          ref={selector}
          type="file"
          accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          aria-label="Archivo del extracto"
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null);
            previa.reset();
            setPerfil(null);
          }}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
            <Boton variante="secundario" onClick={() => selector.current?.click()}>
              {archivo ? 'Cambiar archivo' : 'Elegir archivo'}
            </Boton>
            {archivo && <span className="text-sm text-slate-700">{archivo.name}</span>}
          </div>
          <Campo etiqueta="Moneda del extracto">
            {(a11y) => (
              <Seleccion {...a11y} value={moneda} onChange={(e) => setMoneda(e.target.value)}>
                <option value="COP">COP – Pesos</option>
                <option value="USD">USD – Dólares</option>
                <option value="BRL">BRL – Reales</option>
                <option value="EUR">EUR – Euros</option>
              </Seleccion>
            )}
          </Campo>
          <Campo etiqueta="Últimos 4 dígitos de la tarjeta" ayuda="Opcional; evita cruzar pagos de otra tarjeta" error={ultimos4Invalidos ? 'Deben ser 4 números' : undefined}>
            {(a11y) => <Entrada {...a11y} inputMode="numeric" maxLength={4} value={ultimos4} onChange={(e) => setUltimos4(e.target.value.trim())} />}
          </Campo>
          <div className="flex items-end">
            <Boton className="w-full" disabled={!archivo} cargando={previa.isPending && !perfil} onClick={() => leer()}>
              Leer archivo
            </Boton>
          </div>
        </div>
      </Tarjeta>

      {previa.error && <Alerta tono="peligro">{mensajeDeError(previa.error)}</Alerta>}

      {datos && perfil && (
        <>
          <EditorPerfil
            datos={datos}
            perfil={perfil}
            cambiar={cambiar}
            usarGuardado={(p) => {
              setPerfil(p);
              leer(p);
            }}
          />
          <div className="flex flex-wrap items-center justify-end gap-3">
            {cambiado && <span className="text-sm text-amber-800">Cambió el formato: actualice la vista previa antes de cargar.</span>}
            <Boton variante="secundario" cargando={previa.isPending} onClick={() => leer(perfil)}>
              Actualizar vista previa
            </Boton>
          </div>
          <VistaPrevia datos={datos} />
          <Tarjeta className="space-y-3">
            <h2 className="text-lg font-semibold">3. Cargar y cruzar con las facturas</h2>
            {esContabilidad && (
              <Campo etiqueta="Guardar este formato como (opcional)" ayuda="Para reutilizarlo con los próximos extractos de este banco">
                {(a11y) => <Entrada {...a11y} maxLength={80} placeholder="Ej.: Banco X – débito corporativo" value={guardarComo} onChange={(e) => setGuardarComo(e.target.value)} />}
              </Campo>
            )}
            {cargar.error && <Alerta tono="peligro">{mensajeDeError(cargar.error)}</Alerta>}
            <div className="flex justify-end">
              <Boton disabled={cambiado || datos.totalCargos === 0 || ultimos4Invalidos} cargando={cargar.isPending} onClick={enviar}>
                Cargar y conciliar ({datos.totalCargos} cargos)
              </Boton>
            </div>
          </Tarjeta>
        </>
      )}
    </div>
  );
}

function EditorPerfil({
  datos,
  perfil,
  cambiar,
  usarGuardado,
}: {
  datos: VistaPreviaExtractoResponse;
  perfil: PerfilExtractoDto;
  cambiar: (c: (p: PerfilExtractoDto) => PerfilExtractoDto) => void;
  usarGuardado: (p: PerfilExtractoDto) => void;
}) {
  const encabezados = datos.filas[perfil.filaEncabezado - 1] ?? [];
  const ancho = Math.max(...datos.filas.map((f) => f.length), 1);
  const opciones = Array.from({ length: ancho }, (_, i) => ({ valor: i, texto: `${letra(i)}${encabezados[i] ? ` · ${encabezados[i]}` : ''}` }));
  const columnasSeparadas = perfil.columnas.valor === null;

  const selectorColumna = (etiqueta: string, clave: keyof PerfilExtractoDto['columnas'], opcional = false) => (
    <Campo etiqueta={etiqueta}>
      {(a11y) => (
        <Seleccion
          {...a11y}
          value={perfil.columnas[clave] ?? ''}
          onChange={(e) => {
            const valor = e.target.value === '' ? null : Number(e.target.value);
            cambiar((p) => ({ ...p, columnas: { ...p.columnas, [clave]: valor } }));
          }}
        >
          {opcional && <option value="">— Ninguna —</option>}
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.texto}
            </option>
          ))}
        </Seleccion>
      )}
    </Campo>
  );

  return (
    <Tarjeta className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">2. ¿Cómo leer este archivo?</h2>
          <p className="text-sm text-slate-600">Revise que cada dato apunte a la columna correcta.</p>
        </div>
        {datos.confianza === 'BAJA' ? <Insignia tono="aviso">Revise el formato</Insignia> : <Insignia tono="exito">Formato reconocido</Insignia>}
      </div>
      {datos.perfilesGuardados.length > 0 && (
        <Campo etiqueta="Usar un formato guardado">
          {(a11y) => (
            <Seleccion
              {...a11y}
              defaultValue=""
              onChange={(e) => {
                const elegido = datos.perfilesGuardados.find((p) => p.id === e.target.value);
                if (elegido) usarGuardado(elegido.perfil);
              }}
            >
              <option value="">— Elegir —</option>
              {datos.perfilesGuardados.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo etiqueta="Fila de títulos">
          {(a11y) => (
            <Entrada
              {...a11y}
              type="number"
              min={0}
              max={100}
              value={perfil.filaEncabezado}
              onChange={(e) => cambiar((p) => ({ ...p, filaEncabezado: Math.max(0, Number(e.target.value) || 0) }))}
            />
          )}
        </Campo>
        {selectorColumna('Fecha', 'fecha')}
        {selectorColumna('Descripción / comercio', 'descripcion')}
        {selectorColumna('Referencia', 'referencia', true)}
        <Campo etiqueta="El valor viene en">
          {(a11y) => (
            <Seleccion
              {...a11y}
              value={columnasSeparadas ? 'separadas' : 'una'}
              onChange={(e) =>
                cambiar((p) => ({
                  ...p,
                  columnas:
                    e.target.value === 'una'
                      ? { ...p.columnas, valor: p.columnas.debito ?? 0, debito: null, credito: null }
                      : { ...p.columnas, valor: null, debito: p.columnas.valor ?? 0, credito: null },
                }))
              }
            >
              <option value="una">Una columna (con signo)</option>
              <option value="separadas">Columnas de débito y crédito</option>
            </Seleccion>
          )}
        </Campo>
        {columnasSeparadas ? (
          <>
            {selectorColumna('Débito (cargos)', 'debito')}
            {selectorColumna('Crédito (abonos)', 'credito', true)}
          </>
        ) : (
          <>
            {selectorColumna('Valor', 'valor')}
            <Campo etiqueta="Los cargos se ven">
              {(a11y) => (
                <Seleccion {...a11y} value={perfil.signoCargos} onChange={(e) => cambiar((p) => ({ ...p, signoCargos: e.target.value as PerfilExtractoDto['signoCargos'] }))}>
                  <option value="NEGATIVO">Negativos (−45.000)</option>
                  <option value="POSITIVO">Positivos (45.000)</option>
                </Seleccion>
              )}
            </Campo>
          </>
        )}
        <Campo etiqueta="Formato de fecha">
          {(a11y) => (
            <Seleccion {...a11y} value={perfil.formatoFecha} onChange={(e) => cambiar((p) => ({ ...p, formatoFecha: e.target.value as PerfilExtractoDto['formatoFecha'] }))}>
              {FORMATOS_FECHA_EXTRACTO.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Separador de decimales">
          {(a11y) => (
            <Seleccion {...a11y} value={perfil.separadorDecimal} onChange={(e) => cambiar((p) => ({ ...p, separadorDecimal: e.target.value as ',' | '.' }))}>
              <option value=",">Coma (1.234,56)</option>
              <option value=".">Punto (1,234.56)</option>
            </Seleccion>
          )}
        </Campo>
      </div>
    </Tarjeta>
  );
}

function VistaPrevia({ datos }: { datos: VistaPreviaExtractoResponse }) {
  return (
    <Tarjeta className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Vista previa</h2>
        <p className="text-sm text-slate-600">
          {datos.totalCargos} cargos · {datos.totalAbonos} abonos · {datos.totalFilas} filas en el archivo
        </p>
      </div>
      {datos.omitidas.length > 0 && (
        <Alerta tono="aviso" titulo={`${datos.omitidas.length} fila(s) no se pudieron leer`}>
          <ul className="list-disc pl-5">
            {datos.omitidas.slice(0, 5).map((o) => (
              <li key={o.fila}>
                Fila {o.fila}: {o.motivo}
              </li>
            ))}
          </ul>
        </Alerta>
      )}
      {datos.movimientos.length === 0 ? (
        <Alerta tono="peligro">No se encontró ningún movimiento: revise la fila de títulos y las columnas.</Alerta>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="hidden py-1 pr-2 sm:table-cell">Fila</th>
                <th className="py-1 pr-2">Fecha</th>
                <th className="py-1 pr-2">Descripción</th>
                <th className="py-1 pr-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {datos.movimientos.map((m) => (
                <tr key={m.fila} className="border-t border-slate-100">
                  <td className="hidden py-1.5 pr-2 text-slate-500 sm:table-cell">{m.fila}</td>
                  <td className="py-1.5 pr-2 align-top text-xs whitespace-nowrap sm:text-sm">{formatoFechaCalendario(m.fecha)}</td>
                  <td className="py-1.5 pr-2 align-top break-words">{m.descripcion}</td>
                  <td className={`py-1.5 text-right align-top font-medium whitespace-nowrap ${m.tipo === 'DEBITO' ? 'text-slate-900' : 'text-emerald-700'}`}>
                    {m.tipo === 'DEBITO' ? '−' : '+'} {formatoDinero(m.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  );
}
