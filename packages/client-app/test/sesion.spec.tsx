import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Api } from '@viaticos/client-api';
import type { SesionResponse, SolicitudResponse } from '@viaticos/contracts';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ClienteProvider,
  aprobadorActual,
  clavesSolicitudes,
  crearSesionStore,
  restaurarSesion,
  useAprobarSolicitud,
  useIniciarSesion,
} from '../src';

const sesion: SesionResponse = {
  accessToken: 'tok',
  expiraEn: '2026-10-15T16:00:00Z',
  usuario: { id: 'u-jefe', nombre: 'Carlos', email: 'c@e.co', roles: ['APROBADOR'] },
};

const solicitud = (cambios: Partial<SolicitudResponse> = {}): SolicitudResponse => ({
  id: 's1',
  estado: 'EN_APROBACION',
  viajeroId: 'u-viajero',
  viajeroNombre: 'Ana',
  motivo: 'Visita a cliente',
  justificacion: null,
  destinos: [],
  presupuesto: { monedaAnticipo: 'USD', lineas: [], totalAnticipo: { monto: '10.00', moneda: 'USD' }, tasasAplicadas: [] },
  escalamiento: { requiereJefeDirectivo: false, motivos: [] },
  ruta: [{ orden: 1, nivel: 'JEFE_INMEDIATO', aprobadorId: 'u-jefe', aprobadorNombre: 'Carlos', estado: 'PENDIENTE', decididoEn: null, comentario: null }],
  creadaEn: '2026-10-15T15:00:00Z',
  actualizadaEn: '2026-10-15T15:00:00Z',
  ...cambios,
});

function montar(api: Partial<Api>) {
  const store = crearSesionStore();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ClienteProvider api={api as Api} sesion={store}>
        {children}
      </ClienteProvider>
    </QueryClientProvider>
  );
  return { store, queryClient, wrapper };
}

describe('sesión', () => {
  it('restaurarSesion recupera la sesión o queda anónima', async () => {
    const store = crearSesionStore();
    await restaurarSesion({ auth: { renovar: async () => sesion } } as unknown as Api, store);
    expect(store.getState()).toMatchObject({ estado: 'autenticada', accessToken: 'tok' });

    const otro = crearSesionStore();
    await restaurarSesion({ auth: { renovar: () => Promise.reject(new Error('401')) } } as unknown as Api, otro);
    expect(otro.getState()).toMatchObject({ estado: 'anonima', accessToken: null });
  });

  it('useIniciarSesion guarda la sesión en el store', async () => {
    const { store, wrapper } = montar({ auth: { login: vi.fn(async () => sesion) } as unknown as Api['auth'] });
    const { result } = renderHook(() => useIniciarSesion(), { wrapper });
    await act(() => result.current.mutateAsync({ email: 'c@e.co', contrasena: 'x' }));
    expect(store.getState().usuario?.id).toBe('u-jefe');
  });
});

describe('mutaciones de solicitudes', () => {
  it('al aprobar actualiza el detalle en caché e invalida los listados', async () => {
    const aprobada = solicitud({ estado: 'APROBADA' });
    const { queryClient, wrapper } = montar({
      solicitudes: { aprobar: vi.fn(async () => aprobada) } as unknown as Api['solicitudes'],
    });
    queryClient.setQueryData(clavesSolicitudes.mias(), [solicitud()]);
    const { result } = renderHook(() => useAprobarSolicitud(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 's1' }));

    expect(queryClient.getQueryData(clavesSolicitudes.detalle('s1'))).toEqual(aprobada);
    await waitFor(() => expect(queryClient.getQueryState(clavesSolicitudes.mias())?.isInvalidated).toBe(true));
  });
});

describe('reglas de UI', () => {
  it('identifica al aprobador del turno', () => {
    expect(aprobadorActual(solicitud())).toBe('u-jefe');
    expect(aprobadorActual(solicitud({ estado: 'APROBADA' }))).toBeNull();
  });
});
