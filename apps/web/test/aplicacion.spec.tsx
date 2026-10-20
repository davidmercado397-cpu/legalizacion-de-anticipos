import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Api, ApiError, type Perfil } from '@viaticos/client-api';
import { ClienteProvider, crearSesionStore } from '@viaticos/client-app';
import type { AnticipoDetalle, GastoDetalle } from '@viaticos/contracts';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PanelAcciones } from '../src/features/anticipos/panel-acciones';
import { SeccionRetiros } from '../src/features/anticipos/retiros';
import { EditorGasto } from '../src/features/gastos/editor-gasto';
import { SubirFactura } from '../src/features/gastos/subir-factura';
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
    withdrawals: [],
    approval_steps: [],
    escalation_reasons: [],
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

const paso = (level: 'boss' | 'director' | 'management', approver_id: string | null, status = 'pending') =>
  ({ level, approver_id, approver_name: approver_id, status, decided_by: null, decided_at: null, note: null }) as AnticipoDetalle['approval_steps'][number];

describe('ruta de aprobación', () => {
  const escalada = (estadoJefe = 'pending') =>
    anticipo({ approval_steps: [paso('boss', 'u-jefe', estadoJefe), paso('director', 'u-directivo')] });

  it('el jefe directivo puede aprobar sin esperar al jefe inmediato', () => {
    montar(<PanelAcciones anticipo={escalada()} />, perfil({ id: 'u-directivo' }));
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
  });

  it('el jefe que ya aprobó su paso no vuelve a ver el botón', () => {
    montar(<PanelAcciones anticipo={escalada('approved')} />, perfil({ id: 'u-jefe' }));
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  it('el paso de gerencia lo decide cualquier usuario de gerencia', () => {
    const directivo = anticipo({ approval_steps: [paso('management', null)] });
    montar(<PanelAcciones anticipo={directivo} />, perfil({ id: 'u-gerente', role: 'management' }));
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
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

describe('SubirFactura', () => {
  const archivo = (nombre: string, tipo: string) => new File(['contenido'], nombre, { type: tipo });

  it('sube cada archivo por separado y, si uno falla, sigue con los demás', async () => {
    const subir = vi.fn(async (_archivo: unknown, opciones: { nombre?: string }) => {
      if (opciones.nombre === 'pesada.pdf') throw new ApiError(422, 'file_too_large', 'El archivo es muy pesado.');
      return {};
    });
    montar(<SubirFactura anticipoId="a1" />, perfil({ id: 'u-ana' }), { gastos: { subir } as unknown as Api['gastos'] });
    await userEvent.upload(screen.getByLabelText('Fotos o PDF de las facturas'), [
      archivo('almuerzo.pdf', 'application/pdf'),
      archivo('pesada.pdf', 'application/pdf'),
      archivo('taxi.png', 'image/png'),
    ]);
    expect(await screen.findByText(/Se subieron 2 facturas/)).toBeInTheDocument();
    expect(screen.getByText('pesada.pdf')).toBeInTheDocument();
    expect(screen.getByText(/El archivo es muy pesado/)).toBeInTheDocument();
    expect(subir).toHaveBeenCalledTimes(3);
    expect(subir).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ anticipoId: 'a1', nombre: 'taxi.png' }));
  });

  it('una foto HEIC del iPhone no se envía: explica cómo convertirla', async () => {
    const subir = vi.fn();
    montar(<SubirFactura anticipoId="a1" />, perfil({ id: 'u-ana' }), { gastos: { subir } as unknown as Api['gastos'] });
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText('Fotos o PDF de las facturas'), archivo('IMG_0001.HEIC', 'image/heic'));
    expect(await screen.findByText(/guárdela como JPG/)).toBeInTheDocument();
    expect(subir).not.toHaveBeenCalled();
  });
});

describe('EditorGasto', () => {
  const gasto = (cambios: Partial<GastoDetalle>): GastoDetalle =>
    ({
      id: 'g1',
      employee_id: 'u-ana',
      status: 'received',
      review_status: 'not_required',
      policy_findings: [],
      lines: [],
      file: null,
      last_error: null,
      currency: 'COP',
      cash_allocations: [],
      cash_uncovered: null,
      ...cambios,
    }) as GastoDetalle;
  const aprobado = anticipo({ status: 'approved' });

  it('la factura que la IA sigue reintentando se puede descartar', async () => {
    const descartar = vi.fn(async () => ({}));
    montar(<EditorGasto anticipo={aprobado} gasto={gasto({ last_error: 'OpenRouter answered 404' })} />, perfil({ id: 'u-ana' }), {
      gastos: { descartar } as unknown as Api['gastos'],
    });
    expect(screen.getByText(/La lectura automática falló/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Descartar esta factura' }));
    expect(descartar).toHaveBeenCalledWith('g1');
  });

  it('a quien no es el dueño no le ofrece descartar', () => {
    montar(<EditorGasto anticipo={aprobado} gasto={gasto({})} />, perfil({ id: 'u-jefe' }));
    expect(screen.queryByRole('button', { name: 'Descartar esta factura' })).not.toBeInTheDocument();
  });
});

describe('SeccionRetiros', () => {
  const retiro = {
    id: 'r1',
    withdrawn_on: '2026-10-14',
    currency: 'BRL',
    amount: '500.00',
    official_rate: '800',
    official_rate_date: '2026-10-14',
    official_source: 'ecb_cross',
    debited_amount: null,
    fee_amount: null,
    rate: '800',
    value: '400000.00',
    remaining: '300.00',
    note: null,
    updated_at: '2026-10-14T12:00:00Z',
  } as const;
  const enBrl = anticipo({
    status: 'approved',
    currency: 'BRL',
    settlement_currency: 'COP',
    balance: { currency: 'COP', amount: '2400000', applied: '0', pending: '2400000', disbursed: '0', expenses_count: 0 },
    withdrawals: [retiro],
  } as Partial<AnticipoDetalle>);

  it('el viajero registra y corrige sus retiros; ve cuánto queda de cada uno', () => {
    montar(<SeccionRetiros anticipo={enBrl} />, perfil({ id: 'u-ana', role: 'employee' }));
    expect(screen.getByRole('button', { name: 'Registrar retiro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corregir' })).toBeInTheDocument();
    expect(screen.getByText(/Quedan/)).toHaveTextContent('300');
  });

  it('tesorería solo completa lo debitado y la comisión', () => {
    montar(<SeccionRetiros anticipo={enBrl} />, perfil({ id: 'u-tomas', role: 'treasury' }));
    expect(screen.getByRole('button', { name: 'Registrar lo debitado y la comisión' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar retiro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument();
  });
});
