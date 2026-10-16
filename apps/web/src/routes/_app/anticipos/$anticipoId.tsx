import { createFileRoute } from '@tanstack/react-router';
import { useAnticipo, useDescargarExcel, useSesion } from '@viaticos/client-app';
import { InsigniaAnticipo, ResumenSaldo } from '../../../features/anticipos/componentes';
import { LineaDeTiempo } from '../../../features/anticipos/linea-tiempo';
import { PanelAcciones } from '../../../features/anticipos/panel-acciones';
import { RutaAprobacion } from '../../../features/anticipos/ruta-aprobacion';
import { ListaGastos } from '../../../features/gastos/componentes';
import { SubirFactura } from '../../../features/gastos/subir-factura';
import { etiqueta } from '../../../i18n';
import { mensajeDeError } from '../../../lib/errores';
import { formatoDinero, formatoMomento, rangoFechas } from '../../../lib/formato';
import { puede } from '../../../lib/roles';
import { Boton } from '../../../ui/boton';
import { Alerta, Cargando, Tarjeta } from '../../../ui/superficies';
import { sinRechazo } from '../../../lib/sin-rechazo';

export const Route = createFileRoute('/_app/anticipos/$anticipoId')({ component: DetalleAnticipo });

function DetalleAnticipo() {
  const { anticipoId } = Route.useParams();
  const usuario = useSesion((s) => s.usuario);
  const { data: anticipo, isPending, error } = useAnticipo(anticipoId);
  const excel = useDescargarExcel();

  if (isPending) return <Cargando />;
  if (error) return <Alerta tono="peligro">{mensajeDeError(error)}</Alerta>;

  const propio = usuario?.id === anticipo.employee_id;
  const sinConfirmar = anticipo.expenses.filter((g) => ['received', 'processing', 'extracted', 'failed'].includes(g.status)).length;

  async function descargar() {
    const { archivo, nombre } = await excel.mutateAsync(anticipo!.id);
    const url = URL.createObjectURL(archivo);
    const enlace = Object.assign(document.createElement('a'), { href: url, download: nombre });
    enlace.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{anticipo.destination ?? anticipo.purpose}</h1>
          <p className="text-sm text-slate-600">
            {!propio && `${anticipo.employee.full_name} · `}
            {rangoFechas(anticipo.start_date, anticipo.end_date)} · {etiqueta('tipo', anticipo.kind)}
          </p>
        </div>
        <InsigniaAnticipo estado={anticipo.status} />
      </div>

      <Tarjeta className="space-y-4">
        <p className="text-sm text-slate-700">{anticipo.purpose}</p>
        <ResumenSaldo saldo={anticipo.balance} />
        <RutaAprobacion anticipo={anticipo} />
        {anticipo.budget_amount && anticipo.budget_amount !== anticipo.amount && anticipo.escalation_reasons.length === 0 && (
          <Alerta tono="aviso" titulo={`Pidió un valor distinto al sugerido (${formatoDinero(anticipo.budget_amount, anticipo.currency)})`}>
            {anticipo.budget_justification}
          </Alerta>
        )}
        {anticipo.decision_note && anticipo.status !== 'closed' && <Alerta tono="info">“{anticipo.decision_note}”</Alerta>}
        {anticipo.disbursed_at && (
          <p className="text-sm text-slate-600">
            Desembolsado el {formatoMomento(anticipo.disbursed_at)} por {etiqueta('desembolso', anticipo.disbursement_method)}
            {anticipo.disbursement_ref && ` (${anticipo.disbursement_ref})`}.
          </p>
        )}
        {anticipo.settlement_status && (
          <p className="text-sm font-medium text-slate-700">{etiqueta('liquidacion', anticipo.settlement_status)}</p>
        )}
      </Tarjeta>

      {propio && anticipo.status === 'approved' && sinConfirmar > 0 && (
        <Alerta tono="aviso">
          {sinConfirmar === 1 ? 'Hay 1 factura' : `Hay ${sinConfirmar} facturas`} sin confirmar. Revíselas antes de enviar la legalización.
        </Alerta>
      )}
      <PanelAcciones anticipo={anticipo} />

      {anticipo.status !== 'requested' && anticipo.status !== 'rejected' && anticipo.status !== 'cancelled' && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-700">Facturas</h2>
            <div className="flex gap-2">
              {puede(usuario, 'contabilidad') && (
                <Boton variante="secundario" cargando={excel.isPending} onClick={() => void sinRechazo(descargar)()}>
                  Excel de la legalización
                </Boton>
              )}
              {propio && anticipo.status === 'approved' && <SubirFactura anticipoId={anticipo.id} />}
            </div>
          </div>
          <ListaGastos anticipoId={anticipo.id} gastos={anticipo.expenses} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">Historial</h2>
        <LineaDeTiempo anticipoId={anticipo.id} />
      </section>
    </div>
  );
}
