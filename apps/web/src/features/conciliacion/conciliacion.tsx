import { useExtractos, useSesion } from '@viaticos/client-app';
import type { AnticipoDetalle } from '@viaticos/contracts';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { puede } from '../../lib/roles';
import { Seccion } from '../../ui/pagina';
import { Alerta } from '../../ui/superficies';
import { CargarExtracto } from './cargar-extracto';
import { VistaExtracto } from './vista-extracto';

/** Se carga y se decide con la legalización enviada (en revisión, o devuelta tras enviarse). */
const enviada = (a: AnticipoDetalle) => a.status === 'in_review' || (a.status === 'approved' && !!a.submitted_at);

/**
 * Conciliación con el extracto de la tarjeta (decisiones 7.1 a 7.9): tesorería lo carga y contabilidad
 * decide los cruces antes de cerrar. Un cruce confirmado legaliza el valor que cobró el banco.
 */
export function SeccionConciliacion({ anticipo }: { anticipo: AnticipoDetalle }) {
  const usuario = useSesion((s) => s.usuario);
  const tesoreria = puede(usuario, 'tesoreria');
  const contable = puede(usuario, 'contabilidad');
  const visible = enviada(anticipo) || anticipo.status === 'closed';
  const extractos = useExtractos(anticipo.id, visible);
  const lista = extractos.data ?? [];
  if (!visible || (!tesoreria && !contable && lista.length === 0)) return null;

  const sinCargo = anticipo.expenses.filter((g) => g.bank_status === 'no_charge');
  return (
    <Seccion titulo="Extracto de la tarjeta">
      {extractos.isError && <Alerta tono="peligro">{mensajeDeError(extractos.error)}</Alerta>}
      {lista.map((e) => (
        <VistaExtracto key={e.id} extracto={e} anticipo={anticipo} decide={contable && enviada(anticipo)} />
      ))}
      {sinCargo.length > 0 && (
        <Alerta tono="aviso" titulo="Facturas pagadas con tarjeta que no aparecen en el extracto">
          <ul className="list-disc pl-5">
            {sinCargo.map((g) => (
              <li key={g.id}>
                {g.vendor_name ?? 'Sin proveedor'} · {formatoFechaCalendario(g.invoice_date)} · {formatoDinero(g.total, g.currency)}
              </li>
            ))}
          </ul>
        </Alerta>
      )}
      {tesoreria && enviada(anticipo) && <CargarExtracto anticipo={anticipo} primero={lista.length === 0} />}
      {!tesoreria && lista.length === 0 && <p className="text-sm text-slate-500">Tesorería aún no ha cargado el extracto.</p>}
    </Seccion>
  );
}
