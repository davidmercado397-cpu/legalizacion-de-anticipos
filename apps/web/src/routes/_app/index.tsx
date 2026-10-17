import { createFileRoute, redirect } from '@tanstack/react-router';
import { puede } from '../../lib/roles';

/** El inicio depende del rol: el operador de la plataforma no maneja anticipos. */
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    const usuario = context.sesion.getState().usuario;
    if (puede(usuario, 'plataforma')) throw redirect({ to: '/plataforma' });
    throw redirect({ to: puede(usuario, 'solicitar') ? '/anticipos' : '/cuenta/clave' });
  },
});
