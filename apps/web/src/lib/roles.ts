import { redirect } from '@tanstack/react-router';
import type { Perfil } from '@viaticos/client-api';
import type { SesionStore } from '@viaticos/client-app';
import type { Rol } from '@viaticos/contracts';

export type Capacidad = 'solicitar' | 'aprobar' | 'contabilidad' | 'tesoreria' | 'administrar';

/**
 * Qué puede hacer cada rol (espejo de apps/api/app/domain/permissions.py): el jefe aprueba la solicitud,
 * contabilidad revisa y cierra la legalización, tesorería entrega y liquida. La API es la que decide.
 */
const CAPACIDADES: Record<Rol, readonly Capacidad[]> = {
  employee: ['solicitar'],
  approver: ['solicitar', 'aprobar'],
  accountant: ['solicitar', 'aprobar', 'contabilidad'],
  treasury: ['solicitar', 'tesoreria'],
  admin: ['solicitar', 'aprobar', 'contabilidad', 'tesoreria', 'administrar'],
  superadmin: [],
};

export function puede(usuario: Pick<Perfil, 'role'> | null | undefined, capacidad: Capacidad): boolean {
  return !!usuario && CAPACIDADES[usuario.role].includes(capacidad);
}

/** Para `beforeLoad`: sin la capacidad, vuelve al inicio. */
export function exigir(sesion: SesionStore, capacidad: Capacidad) {
  if (!puede(sesion.getState().usuario, capacidad)) throw redirect({ to: '/' });
}
