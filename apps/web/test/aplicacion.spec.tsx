import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Api, Perfil } from '@viaticos/client-api';
import { ClienteProvider, crearSesionStore } from '@viaticos/client-app';
import type { AnticipoDetalle } from '@viaticos/contracts';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PanelAcciones } from '../src/features/anticipos/panel-acciones';
import { FormularioLogin } from '../src/features/sesion/formulario-login';
import { puede } from '../src/lib/roles';

const perfil = (cambios: Partial<Perfil>): Perfil =>
  ({ id: 'u-jefe', full_name: 'Carlos', email: 'c@e.co', role: 'approver', must_change_password: false, mfa_setup_required: false, company_ids: [], ...cambios }) as Perfil;

const anticipo = (cambios: Partial<AnticipoDetalle> = {}): AnticipoDetalle =>
  ({
    id: 'a1',
    employee_id: 'u-ana',
    status: 'requested',
    currency: 'COP',
    amount: '600000.00',
    disbursed_at: null,
    settlement_status: null,
    balance: { currency: 'COP', amount: '600000.00', applied: '0', pending: '600000.00', disbursed: '0', expenses_count: 0 },
    expenses: [],
    ...cambios,
  }) as AnticipoDetalle;

function montar(ui: ReactNode, usuario: Perfil | null, api: Partial<Api> = {}) {
  const sesion = crearSesionStore();
  if (usuario) sesion.getState().establecerUsuario(usuario);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClienteProvider api={api as Api} sesion={sesion}>
        {ui}
      </ClienteProvider>
    </QueryClientProvider>,
  );
}

describe('roles', () => {
  it('cada paso tiene su rol y el operador de la plataforma no maneja anticipos', () => {
    expect(puede({ role: 'accountant' }, 'aprobar')).toBe(true);
    expect(puede({ role: 'approver' }, 'contabilidad')).toBe(false);
    expect(puede({ role: 'treasury' }, 'tesoreria')).toBe(true);
    expect(puede({ role: 'accountant' }, 'tesoreria')).toBe(false);
    expect(puede({ role: 'superadmin' }, 'solicitar')).toBe(false);
  });
});

describe('PanelAcciones', () => {
  it('al jefe le ofrece aprobar o rechazar una solicitud ajena, y aprueba', async () => {
    const aprobar = vi.fn(async () => anticipo({ status: 'approved' }));
    montar(<PanelAcciones anticipo={anticipo()} />, perfil({}), { anticipos: { aprobar } as unknown as Api['anticipos'] });
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    expect(aprobar).toHaveBeenCalledWith('a1');
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
  });

  it('a quien la pidió solo le deja cancelarla (nadie aprueba lo suyo)', () => {
    montar(<PanelAcciones anticipo={anticipo()} />, perfil({ id: 'u-ana', role: 'approver' }));
    expect(screen.getByRole('button', { name: 'Cancelar solicitud' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  it('a tesorería le ofrece liquidar el reintegro de una legalización cerrada; a contabilidad no', () => {
    const cerrada = anticipo({ status: 'closed', settlement_status: 'refund_pending' });
    montar(<PanelAcciones anticipo={cerrada} />, perfil({ role: 'treasury' }));
    expect(screen.getByRole('button', { name: 'Registrar reintegro' })).toBeInTheDocument();
  });

  it('la legalización enviada la cierra contabilidad, no el jefe', () => {
    const enRevision = anticipo({ status: 'in_review' });
    const { unmount } = montar(<PanelAcciones anticipo={enRevision} />, perfil({ role: 'approver' }));
    expect(screen.queryByRole('button', { name: 'Aprobar legalización' })).not.toBeInTheDocument();
    unmount();
    montar(<PanelAcciones anticipo={enRevision} />, perfil({ id: 'u-conta', role: 'accountant' }));
    expect(screen.getByRole('button', { name: 'Aprobar legalización' })).toBeInTheDocument();
  });
});

describe('FormularioLogin', () => {
  it('si la cuenta tiene verificación en dos pasos, pide el código', async () => {
    const login = vi.fn(async () => ({ mfa_required: true, mfa_token: 'reto', expires_in: 300, token_type: 'bearer', must_change_password: false }));
    montar(<FormularioLogin />, null, { auth: { login } as unknown as Api['auth'] });
    await userEvent.type(screen.getByLabelText('Correo'), 'laura@empresa.co');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText('Verificación en dos pasos')).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith({ email: 'laura@empresa.co', password: 'clave' });
  });
});
