import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Api } from '@viaticos/client-api';
import { ClienteProvider, crearSesionStore } from '@viaticos/client-app';
import type { EstimadoResponse } from '@viaticos/contracts';
import { describe, expect, it, vi } from 'vitest';
import { TablaPresupuesto } from '../src/features/solicitudes/componentes';
import { FormularioLogin } from '../src/features/sesion/formulario-login';

const presupuesto: EstimadoResponse['presupuesto'] = {
  monedaAnticipo: 'USD',
  totalAnticipo: { monto: '295.00', moneda: 'USD' },
  tasasAplicadas: [],
  lineas: [
    {
      destinoIndice: 0,
      paisCodigo: 'BR',
      conceptoCodigo: 'ALOJAMIENTO',
      conceptoNombre: 'Alojamiento',
      unidad: 'NOCHE',
      cantidad: 4,
      tarifaUnitaria: { monto: '30.00', moneda: 'USD' },
      valorUnitarioSolicitado: { monto: '30.00', moneda: 'USD' },
      subtotal: { monto: '120.00', moneda: 'USD' },
      excedeTarifa: false,
    },
  ],
};
const destinos = [{ paisCodigo: 'BR', ciudad: 'Rio', fechaInicio: '2026-11-02', fechaFin: '2026-11-06' }];

describe('TablaPresupuesto', () => {
  it('propone un nuevo valor al salir del campo y vuelve a la tarifa con null', async () => {
    const alProponer = vi.fn();
    render(<TablaPresupuesto presupuesto={presupuesto} destinos={destinos} alProponer={alProponer} />);
    const campo = screen.getByLabelText(/Valor por noche de Alojamiento en Rio/);

    await userEvent.clear(campo);
    await userEvent.type(campo, '50,5{Enter}');
    expect(alProponer).toHaveBeenLastCalledWith(0, 'ALOJAMIENTO', '50.5');

    await userEvent.clear(campo);
    await userEvent.type(campo, '30{Enter}');
    expect(alProponer).toHaveBeenLastCalledWith(0, 'ALOJAMIENTO', null);
  });

  it('marca un valor inválido sin enviarlo', async () => {
    const alProponer = vi.fn();
    render(<TablaPresupuesto presupuesto={presupuesto} destinos={destinos} alProponer={alProponer} />);
    const campo = screen.getByLabelText(/Valor por noche/);
    await userEvent.clear(campo);
    await userEvent.type(campo, 'abc{Enter}');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(alProponer).not.toHaveBeenCalled();
  });

  it('muestra fechas sin corrimiento de zona horaria', () => {
    render(<TablaPresupuesto presupuesto={presupuesto} destinos={destinos} />);
    expect(screen.getByText(/2 de nov/)).toBeInTheDocument();
  });
});

describe('FormularioLogin', () => {
  function montar(login: Api['auth']['login']) {
    const api = { auth: { login } } as unknown as Api;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ClienteProvider api={api} sesion={crearSesionStore()}>
          <FormularioLogin alIngresar={vi.fn()} />
        </ClienteProvider>
      </QueryClientProvider>,
    );
  }

  it('valida con el esquema compartido antes de llamar a la API', async () => {
    const login = vi.fn();
    montar(login);
    await userEvent.type(screen.getByLabelText('Correo corporativo'), 'no-es-correo');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText('Correo electrónico inválido')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo corporativo')).toHaveAttribute('aria-invalid', 'true');
    expect(login).not.toHaveBeenCalled();
  });
});
