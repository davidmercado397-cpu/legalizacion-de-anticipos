import { createFileRoute, redirect } from '@tanstack/react-router';
import { puede } from '../../lib/roles';

/** El inicio depende del rol: el operador de la plataforma no maneja anticipos. */
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    const usuario = context.sesion.getState().usuario;
    throw redirect({ to: usuario?.role === 'superadmin' || !puede(usuario, 'solicitar') ? '/cuenta/clave' : '/anticipos' });
  },
});
