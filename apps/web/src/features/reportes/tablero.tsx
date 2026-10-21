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
import { CircleCheck, Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { hoyLocal } from '../../lib/fechas';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { Boton, botonClases } from '../../ui/boton';
import { Cifra, Cifras } from '../../ui/cifras';
import { EstadoConsulta, type Consulta } from '../../ui/estado-consulta';
import { Seccion } from '../../ui/pagina';
import { Alerta, EstadoVacio, Esqueleto, Insignia } from '../../ui/superficies';
import { Tabla } from '../../ui/tabla';
import { BarraApilada, BarrasHorizontales, Medidor, type Tramo } from './graficos';

/** Tableros de contabilidad para un periodo y, si se elige, una compañía. Cada uno descarga su Excel. */
export function Tablero({ periodo, moneda, companiaId }: { periodo: Periodo; moneda: string; companiaId: string | undefined }) {
  return (
    <div className="space-y-12">
      <Saldos companiaId={periodo.company_id} moneda={moneda} />
      <div className="grid gap-12 lg:grid-cols-2">
        <Gasto periodo={periodo} moneda={moneda} companiaId={companiaId} />
        <LecturaIa companiaId={companiaId} mes={periodo.end.slice(0, 7)} />
      </div>
      <Cumplimiento periodo={periodo} />
      <OtraCompania periodo={periodo} />
    </div>
  );
}

const nombreMes = (mes: string) =>
  new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-01T00:00:00Z`));
const contar = (n: number | undefined, palabra: string) => (n === undefined ? '' : `${n} ${palabra}${n === 1 ? '' : 's'}`);

/** Una sección de reporte con su Excel; carga, error y contenido como en el resto de la web. */
function SeccionReporte<T>({
  titulo,
  descripcion,
  reporte,
  parametros,
  consulta,
  children,
}: {
  titulo: string;
  descripcion?: string;
  reporte: Reporte;
  parametros: Partial<Periodo>;
  consulta: Consulta<T>;
  children: (datos: T) => ReactNode;
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
    <Seccion
      titulo={titulo}
      acciones={
        <Boton variante="secundario" tamano="pequeno" cargando={descargar.isPending} onClick={bajar}>
          <Download aria-hidden />
          Excel
        </Boton>
      }
    >
      {descripcion && <p className="-mt-1 text-sm text-slate-600">{descripcion}</p>}
      {descargar.isError && <Alerta tono="peligro">{mensajeDeError(descargar.error)}</Alerta>}
      <EstadoConsulta consulta={consulta}>{children}</EstadoConsulta>
    </Seccion>
  );
}

/** Cuando un reporte no tiene nada que mostrar, una línea basta. */
function Nada({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-600">
      <CircleCheck className="size-4 text-emerald-700" aria-hidden />
      {children}
    </p>
  );
}

/** Los tramos de antigüedad que define la API ("0-15", "16-30", "+30", "sin fecha"), del más reciente al más viejo. */
function ordenTramo(t: string) {
  if (t.startsWith('+')) return Number.MAX_SAFE_INTEGER - 1;
  const desde = Number.parseInt(t, 10);
  return Number.isNaN(desde) ? Number.MAX_SAFE_INTEGER : desde;
}
const nombreTramo = (t: string) =>
  t.startsWith('+') ? `Más de ${t.slice(1)} días` : /\d/.test(t) ? `${t.replace('-', '–')} días` : t.charAt(0).toUpperCase() + t.slice(1);
const SECUENCIA = ['bg-marca-200', 'bg-marca-600', 'bg-navy-800'];
const colorTramo = (t: string, i: number) => (t.startsWith('+') ? 'bg-red-600' : Number.isNaN(Number.parseInt(t, 10)) ? 'bg-slate-300' : SECUENCIA[Math.min(i, 2)]!);

const VISIBLES = 10;

function Saldos({ companiaId, moneda }: { companiaId: string | undefined; moneda: string }) {
  const consulta = useSaldosPendientes(companiaId);
  const [todos, setTodos] = useState(false);
  return (
    <SeccionReporte
      titulo="Saldos por legalizar"
      descripcion="Lo que está pendiente hoy, sin importar el periodo elegido. Los días se cuentan desde el regreso."
      reporte="pending-balances"
      parametros={{ company_id: companiaId }}
      consulta={consulta}
    >
      {(filas) => {
        if (filas.length === 0) return <Nada>Nadie tiene saldos por legalizar</Nada>;
        const enMoneda = filas.filter((s) => s.currency === moneda);
        const total = enMoneda.reduce((s, f) => s + Number(f.pending), 0);
        const vencidos = filas.filter((f) => f.bucket.startsWith('+'));
        const tramos: Tramo[] = [...new Set(filas.map((f) => f.bucket))]
          .sort((a, b) => ordenTramo(a) - ordenTramo(b))
          .map((t, i) => {
            const valor = enMoneda.filter((f) => f.bucket === t).reduce((s, f) => s + Number(f.pending), 0);
            return { etiqueta: nombreTramo(t), valor, texto: formatoDinero(valor, moneda), color: colorTramo(t, i) };
          });
        const ordenadas = [...filas].sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
        return (
          <div className="space-y-6">
            <p className="text-[15px] text-slate-700">
              <span className="font-bold tabular-nums text-slate-900">{formatoDinero(total, moneda)}</span> en {contar(filas.length, 'anticipo')}.
              {vencidos.length > 0 && (
                <span className="font-semibold text-red-700">
                  {' '}
                  {vencidos.length === 1 ? '1 lleva' : `${vencidos.length} llevan`} más de {vencidos[0]!.bucket.slice(1)} días.
                </span>
              )}
            </p>
            <BarraApilada etiqueta={`Saldos por antigüedad en ${moneda}`} tramos={tramos} />
            <Tabla
              columnas={[
                'Viajero',
                { titulo: 'Anticipo', secundaria: true },
                { titulo: 'Desde el regreso', numerica: true },
                { titulo: 'Por legalizar', numerica: true },
                { titulo: 'Acciones', oculta: true },
              ]}
              claves={ordenadas.map((s) => s.advance_id)}
              filas={(todos ? ordenadas : ordenadas.slice(0, VISIBLES)).map((s) => [
                <span>
                  <span className="font-semibold text-slate-900">{s.employee_name}</span>
                  <span className="block text-xs text-slate-500 sm:hidden">{s.destination ?? 'Sin destino'}</span>
                </span>,
                <span>
                  {s.destination ?? 'Sin destino'}
                  {s.end_date && (
                    <span className="block text-xs text-slate-500">
                      {s.end_date > hoyLocal() ? 'Regresa' : 'Regresó'} el {formatoFechaCalendario(s.end_date)}
                    </span>
                  )}
                </span>,
                <Dias saldo={s} />,
                formatoDinero(s.pending, s.currency),
                <Link
                  to="/anticipos/$anticipoId"
                  params={{ anticipoId: s.advance_id }}
                  className={botonClases({ variante: 'secundario', tamano: 'pequeno' })}
                >
                  Ver
                </Link>,
              ])}
            />
            {ordenadas.length > VISIBLES && (
              <Boton variante="fantasma" tamano="pequeno" onClick={() => setTodos(!todos)}>
                {todos ? 'Mostrar menos' : `Mostrar los ${ordenadas.length}`}
              </Boton>
            )}
          </div>
        );
      }}
    </SeccionReporte>
  );
}

function Dias({ saldo }: { saldo: SaldoPendiente }) {
  if (saldo.days === null) return <span className="text-slate-500">Sin fecha</span>;
  // La API cuenta 0 mientras el viaje no ha terminado.
  if (saldo.end_date && saldo.end_date > hoyLocal()) return <span className="text-slate-500">Aún de viaje</span>;
  const texto = saldo.days === 1 ? '1 día' : `${saldo.days} días`;
  return saldo.bucket.startsWith('+') ? <Insignia tono="peligro">{texto}</Insignia> : <span>{texto}</span>;
}

/** Las barras van en la moneda de la compañía; lo gastado en otras monedas se lista aparte (no se suma sin tasa). */
function Gasto({ periodo, moneda, companiaId }: { periodo: Periodo; moneda: string; companiaId: string | undefined }) {
  const consulta = useGastoPorConcepto(periodo);
  const categorias = useCategorias(companiaId);
  const nombre = (codigo: string | null) => (codigo ? (categorias.data?.find((c) => c.code === codigo)?.name ?? codigo) : 'Sin categoría');
  return (
    <SeccionReporte titulo="Gasto por categoría" reporte="spend" parametros={periodo} consulta={consulta}>
      {(filas: GastoPorConcepto[]) => {
        if (filas.length === 0) return <Nada>No hay gastos legalizados en el periodo</Nada>;
        const porCategoria = new Map<string, { total: number; facturas: number }>();
        for (const f of filas.filter((x) => x.currency === moneda)) {
          const actual = porCategoria.get(nombre(f.category)) ?? { total: 0, facturas: 0 };
          porCategoria.set(nombre(f.category), { total: actual.total + Number(f.total), facturas: actual.facturas + f.expenses });
        }
        const total = [...porCategoria.values()].reduce((s, v) => s + v.total, 0);
        const facturas = filas.reduce((s, f) => s + f.expenses, 0);
        const otras = new Map<string, number>();
        for (const f of filas.filter((x) => x.currency && x.currency !== moneda)) otras.set(f.currency!, (otras.get(f.currency!) ?? 0) + Number(f.total));
        return (
          <div className="space-y-5">
            <p className="text-[15px] text-slate-700">
              <span className="font-bold tabular-nums text-slate-900">{formatoDinero(total, moneda)}</span> en {contar(facturas, 'factura')}.
            </p>
            <BarrasHorizontales
              etiqueta={`Gasto por categoría en ${moneda}`}
              filas={[...porCategoria.entries()]
                .sort((a, b) => b[1].total - a[1].total)
                .map(([categoria, v]) => ({ etiqueta: categoria, valor: v.total, texto: formatoDinero(v.total, moneda), detalle: contar(v.facturas, 'factura') }))}
            />
            {otras.size > 0 && (
              <p className="text-sm text-slate-600">
                En otras monedas: {[...otras.entries()].map(([m, v]) => formatoDinero(v, m)).join(' · ')}
              </p>
            )}
          </div>
        );
      }}
    </SeccionReporte>
  );
}

function Cumplimiento({ periodo }: { periodo: Periodo }) {
  const consulta = useCumplimientoPresupuesto(periodo);
  return (
    <SeccionReporte
      titulo="Cumplimiento del presupuesto"
      descripcion="Lo calculado con las tarifas de viaje frente a lo legalizado, por anticipo."
      reporte="budget-compliance"
      parametros={periodo}
      consulta={consulta}
    >
      {(datos: CumplimientoPresupuesto[]) => {
        const porAnticipo = new Map<string, { fila: CumplimientoPresupuesto; presupuesto: number; gastado: number }>();
        for (const f of datos) {
          const actual = porAnticipo.get(f.advance_id) ?? { fila: f, presupuesto: 0, gastado: 0 };
          porAnticipo.set(f.advance_id, { ...actual, presupuesto: actual.presupuesto + Number(f.budget), gastado: actual.gastado + Number(f.spent) });
        }
        const filas = [...porAnticipo.values()].sort((a, b) => b.gastado - b.presupuesto - (a.gastado - a.presupuesto));
        if (filas.length === 0) return <Nada>No hay viajes con presupuesto calculado en el periodo</Nada>;
        const pasados = filas.filter((f) => f.gastado > f.presupuesto).length;
        return (
          <div className="space-y-4">
            <p className="text-[15px] text-slate-700">
              {contar(filas.length, 'viaje')}.{' '}
              {pasados > 0 ? (
                <span className="font-semibold text-amber-800">{pasados === 1 ? '1 se pasó' : `${pasados} se pasaron`} del presupuesto.</span>
              ) : (
                'Ninguno se pasó del presupuesto.'
              )}
            </p>
            <Tabla
              columnas={[
                'Viajero',
                { titulo: 'Presupuesto', numerica: true },
                { titulo: 'Legalizado', numerica: true },
                { titulo: 'Diferencia', numerica: true },
                { titulo: 'Acciones', oculta: true },
              ]}
              claves={filas.map((f) => f.fila.advance_id)}
              filas={filas.map(({ fila, presupuesto, gastado }) => [
                <span className="font-semibold text-slate-900">{fila.employee_name}</span>,
                formatoDinero(presupuesto, fila.currency),
                formatoDinero(gastado, fila.currency),
                <span className={gastado > presupuesto ? 'font-semibold text-amber-800' : 'text-slate-600'}>
                  {gastado > presupuesto && '+'}
                  {formatoDinero(gastado - presupuesto, fila.currency)}
                </span>,
                <Link
                  to="/anticipos/$anticipoId"
                  params={{ anticipoId: fila.advance_id }}
                  className={botonClases({ variante: 'secundario', tamano: 'pequeno' })}
                >
                  Ver
                </Link>,
              ])}
            />
          </div>
        );
      }}
    </SeccionReporte>
  );
}

function OtraCompania({ periodo }: { periodo: Periodo }) {
  const consulta = useFacturasOtraCompania(periodo);
  return (
    <SeccionReporte
      titulo="Facturas a nombre de otra compañía"
      descripcion="Gastos legalizados con una factura emitida a otra compañía del grupo."
      reporte="intercompany-invoices"
      parametros={periodo}
      consulta={consulta}
    >
      {(filas) =>
        filas.length === 0 ? (
          <Nada>Ninguna en el periodo</Nada>
        ) : (
          <Tabla
            columnas={['Fecha', 'Proveedor', 'Viajero', 'A nombre de', { titulo: 'Total', numerica: true }]}
            filas={filas.map((f) => [
              <span className="whitespace-nowrap text-slate-500">{formatoFechaCalendario(f.invoice_date)}</span>,
              f.vendor_name ?? '—',
              f.employee_name,
              f.billed_to ?? '—',
              formatoDinero(f.total, f.currency),
            ])}
          />
        )
      }
    </SeccionReporte>
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
    <Seccion titulo={`Lectura con IA en ${nombreMes(mes)}`}>
      {(precision.isError || uso.isError) && <Alerta tono="peligro">{mensajeDeError(precision.error ?? uso.error)}</Alerta>}
      {precision.isPending || uso.isPending ? (
        <Esqueleto filas={4} />
      ) : (
        <div className="space-y-6">
          <Cifras columnas={2}>
            <Cifra titulo="Documentos leídos" valor={String(uso.data?.documents ?? '—')}>
              {uso.data && `${uso.data.included_documents} incluidos en el plan`}
            </Cifra>
            <Cifra titulo="Líneas bien clasificadas" valor={lineas === null ? '—' : `${Math.round(lineas * 100)} %`}>
              {p && contar(p.lines, 'línea')}
            </Cifra>
            <Cifra titulo="Corregidos antes de confirmar" valor={String(p?.corrected_before_confirm ?? '—')}>
              {p && contar(p.documents, 'documento')}
            </Cifra>
            <Cifra titulo="Aciertos por lo aprendido" valor={String(p?.memory_hits ?? '—')}>
              líneas
            </Cifra>
          </Cifras>
          {p && p.documents > 0 && Object.keys(p.fields).length > 0 ? (
            <div className="space-y-2.5">
              <h3 className="text-sm font-bold text-slate-900">Acierto por campo</h3>
              {Object.entries(p.fields).map(([campo, valor]) => (
                <Medidor key={campo} etiqueta={CAMPOS_IA[campo] ?? campo} fraccion={valor} />
              ))}
            </div>
          ) : (
            <EstadoVacio titulo="Sin facturas leídas este mes">El acierto por campo aparece cuando se confirman facturas leídas con IA.</EstadoVacio>
          )}
        </div>
      )}
    </Seccion>
  );
}
