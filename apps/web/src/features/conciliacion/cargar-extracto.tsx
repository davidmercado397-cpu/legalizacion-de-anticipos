import { useCargarExtracto, useVistaPreviaExtracto } from '@viaticos/client-app';
import type { AnticipoDetalle, PerfilExtracto, VistaPreviaExtracto } from '@viaticos/contracts';
import { useRef, useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';


const letra = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `C${i + 1}`);
const esPdf = (archivo: File) => archivo.type === 'application/pdf' || archivo.name.toLowerCase().endsWith('.pdf');

export function CargarExtracto({ anticipo, primero }: { anticipo: AnticipoDetalle; primero: boolean }) {
  const previa = useVistaPreviaExtracto(anticipo.id);
  const cargar = useCargarExtracto(anticipo.id);
  const selector = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ultimos4, setUltimos4] = useState('');
  const [perfil, setPerfil] = useState<PerfilExtracto | null>(null);
  const [cambiado, setCambiado] = useState(false);
  const [abierto, setAbierto] = useState(primero);
  const pdf = !!archivo && esPdf(archivo);
  const ultimos4Mal = ultimos4 !== '' && !/^\d{4}$/.test(ultimos4);

  if (!abierto)
    return (
      <Boton variante="secundario" onClick={() => setAbierto(true)}>
        Cargar otro extracto
      </Boton>
    );

  const leer = (conPerfil?: PerfilExtracto) => {
    if (!archivo) return;
    previa.mutate(
      { archivo, nombre: archivo.name, perfil: conPerfil ?? null },
      {
        onSuccess: (r) => {
          setPerfil(r.profile);
          setCambiado(false);
        },
      },
    );
  };
  const cambiar = (cambios: Partial<PerfilExtracto>) => {
    setPerfil((p) => (p ? { ...p, ...cambios } : p));
    setCambiado(true);
  };
  const enviar = () => {
    if (!archivo) return;
    cargar.mutate(
      { archivo: { archivo, nombre: archivo.name, perfil: pdf ? null : perfil }, ultimos4: ultimos4 || null },
      {
        onSuccess: () => {
          setArchivo(null);
          setPerfil(null);
          previa.reset();
          setAbierto(false);
        },
      },
    );
  };

  return (
    <Tarjeta className="space-y-4">
      <div>
        <h3 className="font-semibold">Cargar el extracto</h3>
        <p className="text-sm text-slate-600">
          Excel o CSV de la banca en línea (el sistema propone cómo leer las columnas y tú lo revisas), o el PDF del banco, que lee la IA.
        </p>
      </div>
      <input
        ref={selector}
        type="file"
        className="hidden"
        aria-label="Archivo del extracto"
        accept=".csv,.txt,.xlsx,.pdf,text/csv,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(ev) => {
          setArchivo(ev.target.files?.[0] ?? null);
          setPerfil(null);
          previa.reset();
          cargar.reset();
        }}
      />
      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Boton variante="secundario" onClick={() => selector.current?.click()}>
            {archivo ? 'Cambiar archivo' : 'Elegir archivo'}
          </Boton>
          {archivo && <span className="text-sm text-slate-700">{archivo.name}</span>}
        </div>
        <Campo etiqueta="Últimos 4 dígitos de la tarjeta" ayuda="Opcional" error={ultimos4Mal ? 'Deben ser 4 números' : undefined}>
          {(p) => <Entrada {...p} inputMode="numeric" maxLength={4} value={ultimos4} onChange={(ev) => setUltimos4(ev.target.value.trim())} />}
        </Campo>
        {archivo && !pdf && (
          <Boton cargando={previa.isPending && !perfil} onClick={() => leer()}>
            Leer archivo
          </Boton>
        )}
      </div>
      {previa.isError && <Alerta tono="peligro">{mensajeDeError(previa.error)}</Alerta>}
      {previa.data && perfil && !pdf && (
        <>
          {!previa.data.confident && <Alerta tono="aviso">No estamos seguros de las columnas: revíselas antes de cargar.</Alerta>}
          <EditorPerfil datos={previa.data} perfil={perfil} cambiar={cambiar} />
          <div className="flex flex-wrap items-center justify-end gap-3">
            {cambiado && <span className="text-sm text-amber-800">Cambió el formato: actualice la vista previa.</span>}
            <Boton variante="secundario" cargando={previa.isPending} onClick={() => leer(perfil)}>
              Actualizar vista previa
            </Boton>
          </div>
          <VistaPrevia datos={previa.data} perfil={perfil} />
        </>
      )}
      {cargar.isError && <Alerta tono="peligro">{mensajeDeError(cargar.error)}</Alerta>}
      {archivo && (pdf || (previa.data && perfil)) && (
        <div className="flex justify-end">
          <Boton
            disabled={ultimos4Mal || (!pdf && (cambiado || previa.data?.charges === 0))}
            cargando={cargar.isPending}
            onClick={enviar}
          >
            {pdf ? 'Leer el PDF y conciliar' : `Cargar y conciliar (${previa.data?.charges ?? 0} cargos)`}
          </Boton>
        </div>
      )}
    </Tarjeta>
  );
}

function EditorPerfil({
  datos,
  perfil,
  cambiar,
}: {
  datos: VistaPreviaExtracto;
  perfil: PerfilExtracto;
  cambiar: (cambios: Partial<PerfilExtracto>) => void;
}) {
  const titulos = (perfil.header_row > 0 ? datos.rows[perfil.header_row - 1] : undefined) ?? [];
  const columnas = Math.max(0, ...datos.rows.map((r) => r.length));
  const opciones = Array.from({ length: columnas }, (_, i) => ({ valor: i, texto: `${letra(i)}${titulos[i] ? ` · ${titulos[i]}` : ''}` }));
  const columna = (etiqueta: string, valor: number | null | undefined, alCambiar: (v: number | null) => void, opcional = false) => (
    <Campo etiqueta={etiqueta}>
      {(p) => (
        <Seleccion {...p} value={valor ?? ''} onChange={(ev) => alCambiar(ev.target.value === '' ? null : Number(ev.target.value))}>
          {opcional && <option value="">—</option>}
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.texto}
            </option>
          ))}
        </Seleccion>
      )}
    </Campo>
  );
  const separadas = perfil.amount_col === null || perfil.amount_col === undefined;
  return (
    <div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
      <Campo etiqueta="Fila de títulos" ayuda="0 = sin títulos">
        {(p) => (
          <Entrada {...p} type="number" min={0} max={50} value={perfil.header_row} onChange={(ev) => cambiar({ header_row: Number(ev.target.value) })} />
        )}
      </Campo>
      {columna('Fecha', perfil.date_col, (v) => cambiar({ date_col: v ?? 0 }))}
      {columna('Descripción', perfil.description_col, (v) => cambiar({ description_col: v ?? 0 }))}
      <Campo etiqueta="Valores">
        {(p) => (
          <Seleccion
            {...p}
            value={separadas ? 'separadas' : 'una'}
            onChange={(ev) =>
              cambiar(
                ev.target.value === 'una'
                  ? { amount_col: perfil.debit_col ?? 0, debit_col: null, credit_col: null }
                  : { amount_col: null, debit_col: perfil.amount_col ?? 0 },
              )
            }
          >
            <option value="una">Una columna con signo</option>
            <option value="separadas">Débitos y créditos separados</option>
          </Seleccion>
        )}
      </Campo>
      {separadas ? (
        <>
          {columna('Débitos (cargos)', perfil.debit_col, (v) => cambiar({ debit_col: v }))}
          {columna('Créditos', perfil.credit_col, (v) => cambiar({ credit_col: v }), true)}
        </>
      ) : (
        <>
          {columna('Valor', perfil.amount_col, (v) => cambiar({ amount_col: v }))}
          <Campo etiqueta="Los cargos vienen">
            {(p) => (
              <Seleccion {...p} value={perfil.charges_negative ? 'negativos' : 'positivos'} onChange={(ev) => cambiar({ charges_negative: ev.target.value === 'negativos' })}>
                <option value="negativos">En negativo</option>
                <option value="positivos">En positivo</option>
              </Seleccion>
            )}
          </Campo>
        </>
      )}
      {columna('Referencia', perfil.reference_col, (v) => cambiar({ reference_col: v }), true)}
      <Campo etiqueta="Formato de fecha">
        {(p) => (
          <Seleccion {...p} value={perfil.date_format} onChange={(ev) => cambiar({ date_format: ev.target.value })}>
            {['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD/MM/YY', 'YYYYMMDD'].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </Seleccion>
        )}
      </Campo>
      <Campo etiqueta="Separador de decimales">
        {(p) => (
          <Seleccion {...p} value={perfil.decimal_separator} onChange={(ev) => cambiar({ decimal_separator: ev.target.value })}>
            <option value=",">Coma (1.234,56)</option>
            <option value=".">Punto (1,234.56)</option>
          </Seleccion>
        )}
      </Campo>
      <Campo etiqueta="Moneda del extracto">
        {(p) => <Entrada {...p} maxLength={3} className="uppercase" value={perfil.currency} onChange={(ev) => cambiar({ currency: ev.target.value.toUpperCase() })} />}
      </Campo>
    </div>
  );
}

function VistaPrevia({ datos, perfil }: { datos: VistaPreviaExtracto; perfil: PerfilExtracto }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">
        {datos.total_rows} filas · <strong>{datos.charges} cargos</strong> · {datos.credits} abonos
        {datos.skipped.length > 0 && ` · ${datos.skipped.length} filas no se pudieron leer`}
      </p>
      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
        <table className="w-full text-left text-xs">
          <tbody className="divide-y divide-slate-100">
            {datos.rows.slice(0, 12).map((fila, i) => (
              <tr key={i} className={i + 1 === perfil.header_row ? 'bg-slate-100 font-semibold' : undefined}>
                <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                {fila.map((celda, j) => (
                  <td key={j} className="whitespace-nowrap px-2 py-1">
                    {celda}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {datos.skipped.length > 0 && (
        <details className="text-sm text-slate-600">
          <summary>Filas que no se leyeron</summary>
          <ul className="list-disc pl-5">
            {datos.skipped.slice(0, 20).map((s) => (
              <li key={s.row}>
                Fila {s.row}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

