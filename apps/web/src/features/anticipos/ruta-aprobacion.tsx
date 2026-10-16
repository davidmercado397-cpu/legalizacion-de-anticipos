import type { Perfil } from '@viaticos/client-api';
import type { AnticipoDetalle, PasoAprobacion } from '@viaticos/contracts';
import { etiqueta } from '../../i18n';
import { formatoMomento } from '../../lib/formato';
import { Alerta, Insignia } from '../../ui/superficies';

const TONO: Record<PasoAprobacion['status'], 'neutro' | 'aviso' | 'exito' | 'peligro'> = {
  pending: 'aviso',
  approved: 'exito',
  rejected: 'peligro',
  skipped: 'neutro',
};

/** El turno normal y el nivel superior pendiente, que puede aprobar sin esperar (espejo de la API). */
function decidibles(anticipo: AnticipoDetalle): PasoAprobacion[] {
  if (anticipo.status !== 'requested') return [];
  const pendientes = anticipo.approval_steps.filter((p) => p.status === 'pending');
  const [actual] = pendientes;
  if (!actual) return [];
  const superior = pendientes.find((p) => p.level !== 'boss');
  return superior && superior !== actual ? [actual, superior] : [actual];
}

/** ¿Le toca decidir a este usuario? Las solicitudes sin ruta (anteriores) las decide el jefe, como antes. */
export function puedeDecidir(anticipo: AnticipoDetalle, usuario: Perfil | null): boolean {
  if (!usuario || usuario.id === anticipo.employee_id || anticipo.status !== 'requested') return false;
  if (anticipo.approval_steps.length === 0) return ['approver', 'accountant', 'admin'].includes(usuario.role);
  return decidibles(anticipo).some((p) => (p.approver_id ? p.approver_id === usuario.id : usuario.role === 'management'));
}

export function RutaAprobacion({ anticipo }: { anticipo: AnticipoDetalle }) {
  if (anticipo.approval_steps.length === 0) return null;
  return (
    <div className="space-y-3">
      {anticipo.escalation_reasons.length > 0 && (
        <Alerta tono="aviso" titulo="Necesita la aprobación del jefe directivo">
          <ul className="list-disc pl-5">
            {anticipo.escalation_reasons.map((m) => (
              <li key={m.code}>{m.message}</li>
            ))}
          </ul>
          {anticipo.budget_justification && <p className="mt-1">Justificación: “{anticipo.budget_justification}”</p>}
        </Alerta>
      )}
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {anticipo.approval_steps.map((paso, i) => (
          <li key={`${paso.level}-${i}`} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className="text-slate-300">→</span>}
            <span className="rounded-lg bg-slate-50 px-3 py-1.5 ring-1 ring-slate-200">
              <span className="block text-xs text-slate-500">{etiqueta('nivel', paso.level)}</span>
              <span className="font-medium">{paso.approver_name ?? 'Cualquier usuario de gerencia'}</span>{' '}
              <Insignia tono={TONO[paso.status]}>{etiqueta('paso', paso.status)}</Insignia>
              {paso.decided_at && <span className="block text-xs text-slate-500">{formatoMomento(paso.decided_at)}</span>}
              {paso.note && <span className="block text-xs text-slate-600">“{paso.note}”</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
