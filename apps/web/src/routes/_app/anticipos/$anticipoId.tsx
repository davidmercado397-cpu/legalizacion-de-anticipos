import { createFileRoute } from '@tanstack/react-router';
import { useAnticipo, useDescargarExcel, useSesion } from '@viaticos/client-app';
import { CalendarDays, Download, type LucideIcon, UserRound, Wallet } from 'lucide-react';
import { EstadoSiesa, InsigniaAnticipo } from '../../../features/anticipos/componentes';
import { FranjaSaldo } from '../../../features/anticipos/franja-saldo';
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
import { EncabezadoPagina, Seccion } from '../../../ui/pagina';
import { Alerta, Esqueleto } from '../../../ui/superficies';
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

  async function descargar() {
    const { archivo, nombre } = await excel.mutateAsync(anticipo!.id);
    const url = URL.createObjectURL(archivo);
    const enlace = Object.assign(document.createElement('a'), { href: url, download: nombre });
    enlace.click();
    URL.revokeObjectURL(url);
  }

  const meta = [
    !propio && { icono: UserRound, texto: anticipo.employee.full_name },
    anticipo.start_date && { icono: CalendarDays, texto: rangoFechas(anticipo.start_date, anticipo.end_date) },
    { icono: Wallet, texto: etiqueta('tipo', anticipo.kind) },
  ].filter((m): m is { icono: LucideIcon; texto: string } => !!m);
  const conFacturas = !['requested', 'rejected', 'cancelled'].includes(anticipo.status);

  return (
    <div className="space-y-8">
      <EncabezadoPagina
        titulo={anticipo.destination ?? anticipo.purpose}
        junto={<InsigniaAnticipo estado={anticipo.status} />}
        volver={propio ? { to: '/anticipos', texto: 'Mis anticipos' } : undefined}
        descripcion={
          <div className="space-y-2">
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {meta.map(({ icono: Icono, texto }) => (
                <span key={texto} className="inline-flex items-center gap-1.5">
                  <Icono className="size-4 text-slate-500" aria-hidden />
                  {texto}
                </span>
              ))}
            </p>
            {anticipo.destination && <p className="text-slate-700">{anticipo.purpose}</p>}
          </div>
        }
      />

      <PanelAcciones anticipo={anticipo} />

      <FranjaSaldo anticipo={anticipo} />

      {anticipo.overdue && anticipo.status === 'approved' && anticipo.legalization_due && (
        <Alerta tono="peligro" titulo="Legalización vencida">
          El plazo para enviarla era el {formatoFechaCalendario(anticipo.legalization_due)}.
        </Alerta>
      )}
      {anticipo.settlement_currency && (
        <Alerta tono="info">
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
        </Alerta>
      )}
      {anticipo.budget_amount && anticipo.budget_amount !== anticipo.amount && anticipo.escalation_reasons.length === 0 && (
        <Alerta tono="aviso" titulo={`Pidió un valor distinto al sugerido (${formatoDinero(anticipo.budget_amount, anticipo.currency)})`}>
          {anticipo.budget_justification}
        </Alerta>
      )}
      {anticipo.decision_note && anticipo.status !== 'closed' && <Alerta tono="info">“{anticipo.decision_note}”</Alerta>}
      {anticipo.settlement_status && <Alerta tono="info">{etiqueta('liquidacion', anticipo.settlement_status)}</Alerta>}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {conFacturas && (
            <Seccion
              titulo="Facturas"
              acciones={
                puede(usuario, 'contabilidad') && (
                  <Boton variante="secundario" tamano="pequeno" cargando={excel.isPending} onClick={() => void sinRechazo(descargar)()}>
                    <Download aria-hidden />
                    Excel de la legalización
                  </Boton>
                )
              }
            >
              {propio && anticipo.status === 'approved' && <SubirFactura anticipoId={anticipo.id} />}
              <ListaGastos
                anticipoId={anticipo.id}
                gastos={anticipo.expenses}
                totalLegalizado={formatoDinero(anticipo.balance.applied, anticipo.balance.currency)}
              />
            </Seccion>
          )}
          <SeccionRetiros anticipo={anticipo} />
          <SeccionConciliacion anticipo={anticipo} />
        </div>

        <aside className="space-y-10">
          {anticipo.approval_steps.length > 0 && (
            <Seccion titulo="Aprobación">
              <RutaAprobacion anticipo={anticipo} />
            </Seccion>
          )}
          {anticipo.disbursed_at && (
            <Seccion titulo="Desembolso">
              <p className="text-sm text-slate-700">
                {formatoMomento(anticipo.disbursed_at)} por {etiqueta('desembolso', anticipo.disbursement_method).toLowerCase()}
                {anticipo.disbursement_ref && ` (${anticipo.disbursement_ref})`}.
              </p>
            </Seccion>
          )}
          {(puede(usuario, 'contabilidad') || puede(usuario, 'tesoreria')) && anticipo.erp_advance_status && (
            <Seccion titulo="Siesa">
              <EstadoSiesa anticipo={anticipo} />
            </Seccion>
          )}
          <Seccion titulo="Historial">
            <LineaDeTiempo anticipoId={anticipo.id} />
          </Seccion>
        </aside>
      </div>
    </div>
  );
}
