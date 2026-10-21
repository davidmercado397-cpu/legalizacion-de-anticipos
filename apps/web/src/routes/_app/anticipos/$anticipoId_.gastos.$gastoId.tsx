import { createFileRoute } from '@tanstack/react-router';
import { useAnticipo } from '@viaticos/client-app';
import { InsigniaGasto } from '../../../features/gastos/componentes';
import { EditorGasto } from '../../../features/gastos/editor-gasto';
import { etiqueta } from '../../../i18n';
import { formatoDinero, formatoFechaCalendario } from '../../../lib/formato';
import { EstadoConsulta } from '../../../ui/estado-consulta';
import { EncabezadoPagina } from '../../../ui/pagina';
import { EstadoVacio, Esqueleto } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/anticipos/$anticipoId_/gastos/$gastoId')({ component: DetalleGasto });

/** El gasto se toma del detalle del anticipo: trae la foto, las líneas y el estado de la legalización. */
function DetalleGasto() {
  const { anticipoId, gastoId } = Route.useParams();
  const consulta = useAnticipo(anticipoId);
  return (
    <EstadoConsulta consulta={consulta} cargando={<Esqueleto filas={8} />}>
      {(anticipo) => {
        const gasto = anticipo.expenses.find((g) => g.id === gastoId);
        const volver = { to: '/anticipos/$anticipoId' as const, params: { anticipoId }, texto: anticipo.destination ?? anticipo.purpose };
        if (!gasto)
          return (
            <div className="space-y-8">
              <EncabezadoPagina titulo="Factura" volver={volver} />
              <EstadoVacio titulo="Esta factura ya no está en el anticipo" />
            </div>
          );
        const datos = [
          gasto.invoice_date && formatoFechaCalendario(gasto.invoice_date),
          gasto.total && formatoDinero(gasto.total, gasto.currency),
          etiqueta('origen', gasto.source),
        ].filter(Boolean);
        return (
          <div className="space-y-8">
            <EncabezadoPagina
              titulo={gasto.vendor_name ?? 'Factura sin proveedor'}
              junto={<InsigniaGasto estado={gasto.status} />}
              volver={volver}
              descripcion={datos.join(' · ')}
            />
            <EditorGasto anticipo={anticipo} gasto={gasto} />
          </div>
        );
      }}
    </EstadoConsulta>
  );
}
