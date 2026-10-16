import { redirect } from '@tanstack/react-router';
import type { Perfil } from '@viaticos/client-api';
import type { SesionStore } from '@viaticos/client-app';
import type { Rol } from '@viaticos/contracts';

/** Cada rol incluye lo del anterior (apps/api/app/domain/permissions.py). El superadmin va aparte. */
const NIVEL: Record<Rol, number> = { employee: 0, approver: 1, accountant: 2, admin: 3, superadmin: -1 };

export type Capacidad = 'solicitar' | 'aprobar' | 'contabilidad' | 'administrar';
const MINIMO: Record<Capacidad, Rol> = { solicitar: 'employee', aprobar: 'approver', contabilidad: 'accountant', administrar: 'admin' };

export function puede(usuario: Pick<Perfil, 'role'> | null | undefined, capacidad: Capacidad): boolean {
  return !!usuario && NIVEL[usuario.role] >= NIVEL[MINIMO[capacidad]];
}

/** Para `beforeLoad`: sin la capacidad, vuelve al inicio. */
export function exigir(sesion: SesionStore, capacidad: Capacidad) {
  if (!puede(sesion.getState().usuario, capacidad)) throw redirect({ to: '/' });
}
