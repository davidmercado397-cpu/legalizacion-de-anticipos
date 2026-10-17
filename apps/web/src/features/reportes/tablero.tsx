import type { Periodo, Reporte } from '@viaticos/client-api';
import {
  useCategorias,
  useCumplimientoPresupuesto,
  useDescargarReporte,
  useFacturasOtraCompania,
  useGastoPorConcepto,
  usePrecisionIa,
  useSaldosPendientes,
  useUsoMes,
} from '@viaticos/client-app';
import type { CumplimientoPresupuesto, GastoPorConcepto, SaldoPendiente } from '@viaticos/contracts';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Alerta, Cargando, EstadoVacio, Insignia, Tarjeta } from '../../ui/superficies';
import { BarrasHorizontales, Indicador, Medidor } from './graficos';

/** Tableros de contabilidad para un periodo y, si se elige, una compañía. Cada uno descarga su Excel. */
export function Tablero({ periodo, moneda, companiaId }: { periodo: Periodo; moneda: string; companiaId: string | undefined }) {
  const saldos = useSaldosPendientes(periodo.company_id);
  const gasto = useGastoPorConcepto(periodo);
  const otra = useFacturasOtraCompania(periodo);
  const mes = periodo.end.slice(0, 7);

  const pendientes = (saldos.data ?? []).filter((s) => s.currency === moneda);
  const vencidos = (saldos.data ?? []).filter((s) => (s.days ?? 0) > 30);
  const gastado = (gasto.data ?? []).filter((g) => g.currency === moneda).reduce((suma, g) => suma + Number(g.total), 0);

  return (
    <div className="space-y-8">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Por legalizar" valor={formatoDinero(sumar(pendientes, 'pending'), moneda)} detalle={contar(saldos.data?.length, 'anticipo')} />
        <Indicador titulo="Con más de 30 días" valor={String(vencidos.length)} detalle="desde el regreso" alerta={vencidos.length > 0} />
        <Indicador titulo="Gasto del periodo" valor={formatoDinero(gastado, moneda)} detalle={contar(sumarCampo(gasto.data, 'expenses'), 'factura')} />
        <Indicador titulo="Facturas a otra compañía" valor={String(otra.data?.length ?? 0)} detalle="del grupo" alerta={(otra.data?.length ?? 0) > 0} />
      </dl>

      <Seccion titulo="Saldos por legalizar" reporte="pending-balances" parametros={{ company_id: periodo.company_id }} consulta={saldos}>
        {saldos.data && <Saldos filas={saldos.data} />}
      </Seccion>

      <Seccion titulo="Gasto por categoría" reporte="spend" parametros={periodo} consulta={gasto}>
        {gasto.data && <Gasto filas={gasto.data} moneda={moneda} companiaId={companiaId} />}
      </Seccion>

      <Cumplimiento periodo={periodo} />

      <Seccion titulo="Facturas a nombre de otra compañía del grupo" reporte="intercompany-invoices" parametros={periodo} consulta={otra}>
        {otra.data &&
          (otra.data.length === 0 ? (
            <EstadoVacio titulo="Ninguna en el periodo" />
          ) : (
            <Tabla
              columnas={['Fecha', 'Proveedor', 'Viajero', 'A nombre de', 'Total']}
              filas={otra.data.map((f) => [
                formatoFechaCalendario(f.invoice_date),
                f.vendor_name ?? '—',
                f.employee_name,
                f.billed_to ?? '—',
                formatoDinero(f.total, f.currency),
              ])}
            />
          ))}
      </Seccion>

      <LecturaIa companiaId={companiaId} mes={mes} />
    </div>
  );
}

const nombreMes = (mes: string) =>
  new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-01T00:00:00Z`));
const sumar = (filas: SaldoPendiente[], campo: 'pending') => filas.reduce((s, f) => s + Number(f[campo]), 0);
const sumarCampo = (filas: GastoPorConcepto[] | undefined, campo: 'expenses') => (filas ?? []).reduce((s, f) => s + f[campo], 0);
const contar = (n: number | undefined, palabra: string) => (n === undefined ? '' : `${n} ${palabra}${n === 1 ? '' : 's'}`);

function Seccion({
  titulo,
  reporte,
  parametros,
  consulta,
  children,
}: {
  titulo: string;
  reporte: Reporte;
  parametros: Partial<Periodo>;
  consulta: { isPending: boolean; isError: boolean; error: unknown; isPlaceholderData?: boolean };
  children: ReactNode;
}) {
  const descargar = useDescargarReporte();
  const bajar = () =>
    descargar.mutate(
      { reporte, parametros },
      {
        onSuccess: ({ archivo, nombre }) => {
          const url = URL.createObjectURL(archivo);
          Object.assign(document.createElement('a'), { href: url, download: nombre }).click();
          URL.revokeObjectURL(url);
        },
      },
    );
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-700">{titulo}</h2>
        <Boton variante="secundario" cargando={descargar.isPending} onClick={bajar}>
          Excel
        </Boton>
      </div>
      {descargar.isError && <Alerta tono="peligro">{mensajeDeError(descargar.error)}</Alerta>}
      {consulta.isPending ? (
        <Cargando />
      ) : consulta.isError ? (
        <Alerta tono="peligro">{mensajeDeError(consulta.error)}</Alerta>
      ) : (
        <div className={consulta.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>{children}</div>
      )}
    </section>
  );
}

function Tabla({ columnas, filas, numericas = [] }: { columnas: string[]; filas: ReactNode[][]; numericas?: number[] }) {
  const derecha = (i: number) => numericas.includes(i) || i === columnas.length - 1;
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            {columnas.map((c, i) => (
              <th key={c} className={`px-4 py-2 ${derecha(i) ? 'text-right' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filas.map((fila, i) => (
            <tr key={i}>
              {fila.map((celda, j) => (
                <td key={j} className={`px-4 py-2 ${derecha(j) ? 'whitespace-nowrap text-right tabular-nums' : ''}`}>
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Saldos({ filas }: { filas: SaldoPendiente[] }) {
  if (filas.length === 0) return <EstadoVacio titulo="Nadie tiene saldos por legalizar" />;
  const tramos = [...new Set(filas.map((f) => f.bucket))];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        {tramos.map((t) => (
          <Insignia key={t} tono={t.startsWith('+') ? 'peligro' : 'neutro'}>
            {t} días: {filas.filter((f) => f.bucket === t).length}
          </Insignia>
        ))}
      </div>
      <Tabla
        columnas={['Viajero', 'Destino', 'Regreso', 'Días', 'Por legalizar']}
        numericas={[3]}
        filas={[...filas]
          .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
          .slice(0, 50)
          .map((s) => [
            s.employee_name,
            <Link key="d" to="/anticipos/$anticipoId" params={{ anticipoId: s.advance_id }} className="text-marca-700 hover:underline">
              {s.destination ?? 'Sin destino'}
            </Link>,
            formatoFechaCalendario(s.end_date),
            s.days ?? '—',
            formatoDinero(s.pending, s.currency),
          ])}
      />
    </div>
  );
}

/** Las barras van en la moneda de la compañía; lo gastado en otras monedas se lista aparte (no se suma sin tasa). */
function Gasto({ filas, moneda, companiaId }: { filas: GastoPorConcepto[]; moneda: string; companiaId: string | undefined }) {
  const categorias = useCategorias(companiaId);
  const nombre = (codigo: string | null) => (codigo ? (categorias.data?.find((c) => c.code === codigo)?.name ?? codigo) : 'Sin categoría');
  if (filas.length === 0) return <EstadoVacio titulo="No hay gastos legalizados en el periodo" />;
  const porCategoria = new Map<string, { total: number; facturas: number }>();
  for (const f of filas.filter((x) => x.currency === moneda)) {
    const actual = porCategoria.get(nombre(f.category)) ?? { total: 0, facturas: 0 };
    porCategoria.set(nombre(f.category), { total: actual.total + Number(f.total), facturas: actual.facturas + f.expenses });
  }
  const otras = new Map<string, number>();
  for (const f of filas.filter((x) => x.currency && x.currency !== moneda)) otras.set(f.currency!, (otras.get(f.currency!) ?? 0) + Number(f.total));
  return (
    <Tarjeta className="space-y-3">
      <BarrasHorizontales
        etiqueta={`Gasto por categoría en ${moneda}`}
        filas={[...porCategoria.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .map(([categoria, v]) => ({ etiqueta: categoria, valor: v.total, texto: formatoDinero(v.total, moneda), detalle: contar(v.facturas, 'factura') }))}
      />
      {otras.size > 0 && (
        <p className="text-sm text-slate-500">
          En otras monedas: {[...otras.entries()].map(([m, v]) => formatoDinero(v, m)).join(' · ')}
        </p>
      )}
    </Tarjeta>
  );
}

function Cumplimiento({ periodo }: { periodo: Periodo }) {
  const consulta = useCumplimientoPresupuesto(periodo);
  const porAnticipo = new Map<string, { fila: CumplimientoPresupuesto; presupuesto: number; gastado: number }>();
  for (const f of consulta.data ?? []) {
    const actual = porAnticipo.get(f.advance_id) ?? { fila: f, presupuesto: 0, gastado: 0 };
    porAnticipo.set(f.advance_id, { ...actual, presupuesto: actual.presupuesto + Number(f.budget), gastado: actual.gastado + Number(f.spent) });
  }
  const filas = [...porAnticipo.values()].sort((a, b) => b.gastado - b.presupuesto - (a.gastado - a.presupuesto));
  return (
    <Seccion titulo="Cumplimiento del presupuesto" reporte="budget-compliance" parametros={periodo} consulta={consulta}>
      {filas.length === 0 ? (
        <EstadoVacio titulo="No hay viajes con presupuesto calculado en el periodo" />
      ) : (
        <Tabla
          columnas={['Viajero', 'Anticipo', 'Presupuesto', 'Legalizado', 'Diferencia']}
          numericas={[2, 3]}
          filas={filas.map(({ fila, presupuesto, gastado }) => [
            fila.employee_name,
            <Link key="a" to="/anticipos/$anticipoId" params={{ anticipoId: fila.advance_id }} className="text-marca-700 hover:underline">
              Ver
            </Link>,
            formatoDinero(presupuesto, fila.currency),
            formatoDinero(gastado, fila.currency),
            <span key="d" className="inline-flex items-center gap-2">
              {gastado > presupuesto && <Insignia tono="aviso">Sobre el presupuesto</Insignia>}
              {formatoDinero(gastado - presupuesto, fila.currency)}
            </span>,
          ])}
        />
      )}
    </Seccion>
  );
}

const CAMPOS_IA: Record<string, string> = {
  vendor_name: 'Proveedor',
  vendor_tax_id: 'NIT',
  invoice_number: 'Número',
  invoice_date: 'Fecha',
  total: 'Total',
  currency: 'Moneda',
  category: 'Categoría',
};

function LecturaIa({ companiaId, mes }: { companiaId: string | undefined; mes: string }) {
  const precision = usePrecisionIa(companiaId, mes);
  const uso = useUsoMes(mes);
  const p = precision.data;
  const lineas = p && p.lines > 0 ? p.lines_matched / p.lines : null;
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-slate-700">Lectura con IA en {nombreMes(mes)}</h2>
      {(precision.isError || uso.isError) && <Alerta tono="peligro">{mensajeDeError(precision.error ?? uso.error)}</Alerta>}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Documentos leídos" valor={String(uso.data?.documents ?? '—')} detalle={uso.data ? `${uso.data.included_documents} incluidos en el plan` : ''} />
        <Indicador titulo="Líneas bien clasificadas" valor={lineas === null ? '—' : `${Math.round(lineas * 100)} %`} detalle={p ? contar(p.lines, 'línea') : ''} />
        <Indicador titulo="Corregidos antes de confirmar" valor={String(p?.corrected_before_confirm ?? '—')} detalle={p ? contar(p.documents, 'documento') : ''} />
        <Indicador titulo="Aciertos por lo aprendido" valor={String(p?.memory_hits ?? '—')} detalle="líneas" />
      </dl>
      {p && Object.keys(p.fields).length > 0 && (
        <Tarjeta className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-700">Acierto por campo</h3>
          {Object.entries(p.fields).map(([campo, valor]) => (
            <Medidor key={campo} etiqueta={CAMPOS_IA[campo] ?? campo} fraccion={valor} />
          ))}
        </Tarjeta>
      )}
    </section>
  );
}
