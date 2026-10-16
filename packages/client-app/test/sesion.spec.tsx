import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { Api, Perfil } from '@viaticos/client-api';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ClienteProvider,
  almacenEnMemoria,
  crearSesionStore,
  pendienteDe,
  restaurarSesion,
  useCambiarClave,
  useIniciarSesion,
  useVerificarMfa,
} from '../src';

const perfil = (cambios: Partial<Perfil> = {}): Perfil =>
  ({ id: 'u1', full_name: 'Ana Analista', email: 'ana@empresa.co', role: 'employee', must_change_password: false, mfa_setup_required: false, ...cambios }) as Perfil;

const tokens = { access_token: 'acceso', refresh_token: 'refresco', expires_in: 900, token_type: 'bearer', must_change_password: false };

function montar(auth: Partial<Api['auth']>) {
  const almacen = almacenEnMemoria();
  const store = crearSesionStore(almacen);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = { auth: { perfil: vi.fn(async () => perfil()), ...auth } } as unknown as Api;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ClienteProvider api={api} sesion={store}>
        {children}
      </ClienteProvider>
    </QueryClientProvider>
  );
  return { store, almacen, api, wrapper };
}

describe('sesión', () => {
  it('restaurarSesion recupera la sesión con el refresh token guardado, o queda anónima', async () => {
    const { store, almacen, api } = montar({ renovar: vi.fn(async () => tokens) });
    almacen.guardar('guardado');
    await restaurarSesion(api, store);
    expect(store.getState()).toMatchObject({ estado: 'autenticada', accessToken: 'acceso' });
    expect(almacen.leer()).toBe('refresco');

    const otro = montar({ renovar: () => Promise.reject(new Error('401')) });
    otro.almacen.guardar('vencido');
    await restaurarSesion(otro.api, otro.store);
    expect(otro.store.getState()).toMatchObject({ estado: 'anonima', accessToken: null });
    expect(otro.almacen.leer()).toBeNull();
  });

  it('el login sin MFA guarda los tokens y el perfil', async () => {
    const { store, almacen, wrapper } = montar({ login: vi.fn(async () => ({ ...tokens, mfa_required: false })) });
    const { result } = renderHook(() => useIniciarSesion(), { wrapper });
    await act(() => result.current.mutateAsync({ email: 'ana@empresa.co', password: 'x' }));
    expect(store.getState()).toMatchObject({ estado: 'autenticada', usuario: { id: 'u1' } });
    expect(almacen.leer()).toBe('refresco');
  });

  it('con MFA el login deja el reto pendiente y el código completa la sesión', async () => {
    const verificarMfa = vi.fn(async () => ({ ...tokens, mfa_required: false }));
    const { store, wrapper } = montar({
      login: vi.fn(async () => ({ mfa_required: true, mfa_token: 'reto-123', expires_in: 300, token_type: 'bearer', must_change_password: false })),
      verificarMfa,
    });
    const login = renderHook(() => useIniciarSesion(), { wrapper });
    await act(() => login.result.current.mutateAsync({ email: 'laura@empresa.co', password: 'x' }));
    expect(store.getState()).toMatchObject({ estado: 'mfa', mfaToken: 'reto-123', accessToken: null });

    const mfa = renderHook(() => useVerificarMfa(), { wrapper });
    await act(() => mfa.result.current.mutateAsync('123456'));
    expect(verificarMfa).toHaveBeenCalledWith('reto-123', '123456');
    expect(store.getState()).toMatchObject({ estado: 'autenticada', mfaToken: null });
  });

  it('después de cambiar la clave vuelve a entrar con la nueva', async () => {
    const login = vi.fn(async () => ({ ...tokens, mfa_required: false }));
    const { store, wrapper } = montar({ cambiarClave: vi.fn(async () => undefined), login });
    store.getState().establecerUsuario(perfil({ must_change_password: true }));
    const { result } = renderHook(() => useCambiarClave(), { wrapper });
    await act(() => result.current.mutateAsync({ actual: 'Temporal-123', nueva: 'Nueva-Clave-2026' }));
    expect(login).toHaveBeenCalledWith({ email: 'ana@empresa.co', password: 'Nueva-Clave-2026' });
    expect(pendienteDe(store.getState().usuario)).toBeNull();
  });

  it('pendienteDe prioriza el cambio de clave sobre la activación del MFA', () => {
    expect(pendienteDe(perfil({ must_change_password: true, mfa_setup_required: true }))).toBe('cambiar_clave');
    expect(pendienteDe(perfil({ mfa_setup_required: true }))).toBe('activar_mfa');
    expect(pendienteDe(null)).toBeNull();
  });
});
