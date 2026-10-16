import { redirect } from '@tanstack/react-router';
import type { SesionStore } from '@viaticos/client-app';

/** Para `beforeLoad`: si el usuario no tiene ninguno de los roles, vuelve a sus solicitudes. */
export function exigirRol(sesion: SesionStore, ...roles: string[]) {
  const propios = sesion.getState().usuario?.roles ?? [];
  if (!roles.some((r) => propios.includes(r as (typeof propios)[number]))) throw redirect({ to: '/solicitudes' });
}
