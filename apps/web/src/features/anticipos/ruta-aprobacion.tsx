import type { Perfil } from '@viaticos/client-api';
import type { AnticipoDetalle, PasoAprobacion } from '@viaticos/contracts';
import { Check, Clock, type LucideIcon, Minus, X } from 'lucide-react';
import { etiqueta } from '../../i18n';
import { cx } from '../../lib/cx';
import { formatoMomento } from '../../lib/formato';
import { Alerta } from '../../ui/superficies';

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

const ICONO: Record<PasoAprobacion['status'], { Icono: LucideIcon; color: string }> = {
  pending: { Icono: Clock, color: 'bg-amber-50 text-amber-700' },
  approved: { Icono: Check, color: 'bg-emerald-50 text-emerald-700' },
  rejected: { Icono: X, color: 'bg-red-50 text-red-700' },
  skipped: { Icono: Minus, color: 'bg-slate-100 text-slate-500' },
};

/** Quién aprueba, en orden: un paso por línea, con su estado, cuándo y lo que dijo. */
export function RutaAprobacion({ anticipo }: { anticipo: AnticipoDetalle }) {
  if (anticipo.approval_steps.length === 0) return null;
  return (
    <div className="space-y-4">
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
      <ol>
        {anticipo.approval_steps.map((paso, i) => {
          const { Icono, color } = ICONO[paso.status];
          const ultimo = i === anticipo.approval_steps.length - 1;
          return (
            <li key={`${paso.level}-${i}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-full', color)}>
                  <Icono className="size-4" aria-hidden />
                </span>
                {!ultimo && <span className="my-1 w-px flex-1 bg-slate-200" aria-hidden />}
              </div>
              <div className={cx('min-w-0 text-sm', !ultimo && 'pb-4')}>
                <p className="font-semibold text-slate-900">{paso.approver_name ?? 'Cualquier usuario de gerencia'}</p>
                <p className="text-slate-500">
                  {etiqueta('nivel', paso.level)} · {etiqueta('paso', paso.status)}
                  {paso.decided_at && ` · ${formatoMomento(paso.decided_at)}`}
                </p>
                {paso.note && <p className="mt-1 text-slate-700">“{paso.note}”</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
