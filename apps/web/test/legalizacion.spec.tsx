import { render, screen } from '@testing-library/react';
import type { LegalizacionResponse } from '@viaticos/contracts';
import { describe, expect, it } from 'vitest';
import { ListaAlertas, ResumenSaldo } from '../src/features/legalizaciones/componentes';

const legalizacion = (saldo: string): LegalizacionResponse => ({
  id: 'l1',
  anticipoId: 'a1',
  viajeroId: 'ana',
  viajeroNombre: 'Ana',
  estado: 'ABIERTA',
  editable: true,
  montoAnticipo: { monto: '395.00', moneda: 'USD' },
  viaje: { inicio: '2026-10-05', fin: '2026-10-09' },
  plazo: { fechaLimite: '2026-11-09', vencida: false },
  resumen: {
    totalAceptado: { monto: '70.00', moneda: 'USD' },
    totalExcluido: { monto: '5.56', moneda: 'USD' },
    saldo: { monto: saldo, moneda: 'USD' },
  },
  soportes: [],
  historial: [],
  creadaEn: '2026-10-10T00:00:00Z',
});

describe('ResumenSaldo', () => {
  it('saldo positivo: el viajero debe reintegrar', () => {
    render(<ResumenSaldo legalizacion={legalizacion('325.00')} />);
    expect(screen.getByText('Debe reintegrar')).toBeInTheDocument();
    expect(screen.getByText(/325,00/)).toBeInTheDocument();
  });

  it('saldo negativo: la empresa reembolsa (se muestra en positivo)', () => {
    render(<ResumenSaldo legalizacion={legalizacion('-45.50')} />);
    expect(screen.getByText('La empresa le reembolsa')).toBeInTheDocument();
    expect(screen.getByText(/45,50/)).toBeInTheDocument();
    expect(screen.queryByText(/-45/)).not.toBeInTheDocument();
  });
});

describe('ListaAlertas', () => {
  it('distingue las alertas que requieren revisión (accesible para lectores de pantalla)', () => {
    render(
      <ListaAlertas
        alertas={[
          { codigo: 'NO_A_NOMBRE_EMPRESA', severidad: 'REVISION', mensaje: 'No está a nombre de la empresa' },
          { codigo: 'LINEAS_EXCLUIDAS', severidad: 'INFO', mensaje: '1 línea excluida' },
        ]}
      />,
    );
    expect(screen.getByText('Requiere revisión:')).toBeInTheDocument();
    expect(screen.getByText('1 línea excluida')).toBeInTheDocument();
  });
});
