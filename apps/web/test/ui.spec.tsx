import { ApiError } from '@viaticos/client-api';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatoFechaCalendario, formatoMomento, rangoFechas } from '../src/lib/formato';
import { botonClases } from '../src/ui/boton';
import { EstadoConsulta, type Consulta } from '../src/ui/estado-consulta';
import { Alerta, EstadoVacio } from '../src/ui/superficies';
import { Tabla } from '../src/ui/tabla';
import { PanelLateral } from '../src/ui/panel-lateral';
import { BarraApilada } from '../src/features/reportes/graficos';

const consulta = <T,>(cambios: Partial<Consulta<T>>): Consulta<T> => ({
  isPending: false,
  isError: false,
  error: null,
  data: undefined,
  refetch: vi.fn(),
  ...cambios,
});

describe('Tabla', () => {
  it('alinea los montos a la derecha y deja el encabezado de acciones solo para el lector de pantalla', () => {
    render(
      <Tabla
        columnas={['Proveedor', { titulo: 'Valor', numerica: true }, { titulo: 'Acciones', oculta: true }]}
        filas={[['Hotel Dann', '$540.000', <button key="b">Ver</button>]]}
        pie={['Total', '$540.000', null]}
      />,
    );
    const [encabezado, fila, pie] = screen.getAllByRole('row');
    expect(within(encabezado!).getByText('Acciones')).toHaveClass('sr-only');
    expect(within(fila!).getByText('$540.000')).toHaveClass('text-right', 'tabular-nums');
    expect(within(pie!).getByText('Total')).toBeInTheDocument();
  });
});

describe('EstadoConsulta', () => {
  it('muestra un esqueleto mientras carga y el contenido cuando llega', () => {
    const { rerender } = render(<EstadoConsulta consulta={consulta<string[]>({ isPending: true })}>{(d) => d.join(', ')}</EstadoConsulta>);
    expect(screen.getByRole('status', { name: 'Cargando' })).toBeInTheDocument();
    rerender(<EstadoConsulta consulta={consulta({ data: ['Cali', 'Pasto'] })}>{(d) => d.join(', ')}</EstadoConsulta>);
    expect(screen.getByText('Cali, Pasto')).toBeInTheDocument();
  });

  it('ante un error explica el motivo y deja reintentar', async () => {
    const refetch = vi.fn();
    const error = new ApiError(503, 'whatsapp_unavailable', 'No pudimos comunicarnos con WhatsApp.');
    render(<EstadoConsulta consulta={consulta({ isError: true, error, refetch })}>{() => 'nunca'}</EstadoConsulta>);
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos comunicarnos con WhatsApp.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe('superficies', () => {
  it('solo un error interrumpe al lector de pantalla', () => {
    render(
      <>
        <Alerta tono="peligro">Falló</Alerta>
        <Alerta tono="aviso">Ojo</Alerta>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Falló');
    expect(screen.getByRole('status')).toHaveTextContent('Ojo');
  });

  it('un estado vacío ofrece la acción para salir de él', () => {
    render(<EstadoVacio titulo="Todavía no has solicitado anticipos" accion={<button>Solicitar anticipo</button>} />);
    expect(screen.getByRole('button', { name: 'Solicitar anticipo' })).toBeInTheDocument();
  });

  it('un enlace puede verse como botón sin copiar sus clases', () => {
    expect(botonClases({ variante: 'secundario', tamano: 'pequeno' })).toContain('ring-slate-300');
    expect(botonClases()).toContain('bg-navy-950');
  });
});

describe('fechas', () => {
  it('todas se muestran como dd/mm/aaaa, también las de un rango y las que llevan hora', () => {
    expect(formatoFechaCalendario('2025-09-29')).toBe('29/09/2025');
    expect(rangoFechas('2026-10-27', '2026-10-29')).toBe('27/10/2026 – 29/10/2026');
    expect(formatoMomento('2026-10-21T15:11:00Z')).toMatch(/^21\/10\/2026, /);
  });
});

describe('BarraApilada', () => {
  it('la leyenda nombra cada tramo con su valor y la barra se describe en porcentajes', () => {
    render(
      <BarraApilada
        etiqueta="Saldos por antigüedad"
        tramos={[
          { etiqueta: '0–15 días', valor: 270000, texto: '$ 270.000', color: 'bg-marca-200' },
          { etiqueta: 'Más de 30 días', valor: 1070000, texto: '$ 1.070.000', color: 'bg-red-600' },
        ]}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName('Saldos por antigüedad: 0–15 días 20 %, Más de 30 días 80 %');
    expect(screen.getByText('Más de 30 días')).toBeInTheDocument();
    expect(screen.getByText('$ 1.070.000')).toBeInTheDocument();
  });
});

describe('PanelLateral', () => {
  it('muestra su contenido con título y se cierra con la X', async () => {
    const alCerrar = vi.fn();
    render(
      <PanelLateral abierto titulo="Ana Analista" alCerrar={alCerrar}>
        <p>Datos de Ana</p>
      </PanelLateral>,
    );
    expect(screen.getByRole('dialog', { name: 'Ana Analista' })).toHaveTextContent('Datos de Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(alCerrar).toHaveBeenCalled();
  });
});
