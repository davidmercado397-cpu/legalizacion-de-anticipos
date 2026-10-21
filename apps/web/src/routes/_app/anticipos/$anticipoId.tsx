import { createFileRoute } from '@tanstack/react-router';
import { useAnticipo, useDescargarExcel, useSesion } from '@viaticos/client-app';
import { EstadoSiesa, InsigniaAnticipo, ResumenSaldo } from '../../../features/anticipos/componentes';
import { LineaDeTiempo } from '../../../features/anticipos/linea-tiempo';
import { PanelAcciones } from '../../../features/anticipos/panel-acciones';
import { SeccionRetiros } from '../../../features/anticipos/retiros';
import { RutaAprobacion } from '../../../features/anticipos/ruta-aprobacion';
import { SeccionConciliacion } from '../../../features/conciliacion/conciliacion';
import { ListaGastos } from '../../../features/gastos/componentes';
import { SubirFactura } from '../../../features/gastos/subir-factura';
import { etiqueta } from '../../../i18n';
import { mensajeDeError } from '../../../lib/errores';
import { formatoDinero, formatoFechaCalendario, formatoMomento, rangoFechas } from '../../../lib/formato';
import { puede } from '../../../lib/roles';
import { Boton } from '../../../ui/boton';
import { EncabezadoPagina } from '../../../ui/pagina';
import { Alerta, Esqueleto, Tarjeta } from '../../../ui/superficies';
import { sinRechazo } from '../../../lib/sin-rechazo';

export const Route = createFileRoute('/_app/anticipos/$anticipoId')({ component: DetalleAnticipo });

function DetalleAnticipo() {
  const { anticipoId } = Route.useParams();
  const usuario = useSesion((s) => s.usuario);
  const { data: anticipo, isPending, error } = useAnticipo(anticipoId);
  const excel = useDescargarExcel();

  if (isPending) return <Esqueleto filas={6} />;
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
      <EncabezadoPagina
        titulo={anticipo.destination ?? anticipo.purpose}
        junto={<InsigniaAnticipo estado={anticipo.status} />}
        volver={propio ? { to: '/anticipos', texto: 'Mis anticipos' } : undefined}
        descripcion={
          <>
            {!propio && `${anticipo.employee.full_name} · `}
            {rangoFechas(anticipo.start_date, anticipo.end_date)} · {etiqueta('tipo', anticipo.kind)}
          </>
        }
      />

      <Tarjeta className="space-y-4">
        <p className="text-sm text-slate-700">{anticipo.purpose}</p>
        {anticipo.legs.length > 1 && (
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            {anticipo.legs.map((tramo, i) => (
              <li key={`${tramo.destination}-${tramo.start_date}`}>
                <span className="font-medium text-slate-800">
                  {i + 1}. {tramo.destination}
                </span>{' '}
                {rangoFechas(tramo.start_date, tramo.end_date)}
              </li>
            ))}
          </ol>
        )}
        <ResumenSaldo saldo={anticipo.balance} />
        {anticipo.settlement_currency && (
          <p className="text-sm text-slate-600">
            Calculado en {anticipo.currency}: {formatoDinero(anticipo.amount, anticipo.currency)}.{' '}
            {anticipo.settlement_amount ? (
              <>
                {anticipo.disbursed_at ? 'Se entregó' : 'Se entrega'} en {anticipo.settlement_currency}:{' '}
                {formatoDinero(anticipo.settlement_amount, anticipo.settlement_currency)} (tasa{' '}
                {Number(anticipo.settlement_rate).toLocaleString('es-CO', { maximumFractionDigits: 2 })} del{' '}
                {formatoFechaCalendario(anticipo.settlement_rate_date)}
                {anticipo.disbursed_at ? '' : ', estimado'}).
              </>
            ) : (
              <>Se entrega en {anticipo.settlement_currency}: el valor lo fija tesorería al desembolsar.</>
            )}{' '}
            La legalización y la diferencia van en {anticipo.settlement_currency}.
          </p>
        )}
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
        {anticipo.legalization_due && anticipo.status === 'approved' && (
          anticipo.overdue ? (
            <Alerta tono="peligro" titulo="Legalización vencida">
              El plazo para enviarla era el {formatoFechaCalendario(anticipo.legalization_due)}.
            </Alerta>
          ) : (
            <p className="text-sm text-slate-600">Envíe la legalización a más tardar el {formatoFechaCalendario(anticipo.legalization_due)}.</p>
          )
        )}
        {(puede(usuario, 'contabilidad') || puede(usuario, 'tesoreria')) && <EstadoSiesa anticipo={anticipo} />}
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
            {puede(usuario, 'contabilidad') && (
              <Boton variante="secundario" cargando={excel.isPending} onClick={() => void sinRechazo(descargar)()}>
                Excel de la legalización
              </Boton>
            )}
          </div>
          {propio && anticipo.status === 'approved' && <SubirFactura anticipoId={anticipo.id} />}
          <ListaGastos anticipoId={anticipo.id} gastos={anticipo.expenses} />
        </section>
      )}

      <SeccionRetiros anticipo={anticipo} />

      <SeccionConciliacion anticipo={anticipo} />

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">Historial</h2>
        <LineaDeTiempo anticipoId={anticipo.id} />
      </section>
    </div>
  );
}
