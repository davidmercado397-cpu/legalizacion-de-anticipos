import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Login } from '@viaticos/contracts';
import { useApi, useContextoSesion } from '../contexto';
import { aplicarLogin } from './api-con-sesion';

export function useIniciarSesion() {
  const api = useApi();
  const store = useContextoSesion();
  return useMutation({
    mutationFn: async (datos: Login) => aplicarLogin(api, store, await api.auth.login(datos)),
  });
}

export function useVerificarMfa() {
  const api = useApi();
  const store = useContextoSesion();
  return useMutation({
    mutationFn: async (codigo: string) => {
      const mfaToken = store.getState().mfaToken;
      if (!mfaToken) throw new Error('No hay un inicio de sesión en curso');
      await aplicarLogin(api, store, await api.auth.verificarMfa(mfaToken, codigo));
    },
  });
}

/** Cambiar la contraseña cierra las sesiones: se vuelve a entrar con la nueva sin pedirla otra vez. */
export function useCambiarClave() {
  const api = useApi();
  const store = useContextoSesion();
  return useMutation({
    mutationFn: async ({ actual, nueva }: { actual: string; nueva: string }) => {
      const email = store.getState().usuario?.email;
      await api.auth.cambiarClave(actual, nueva);
      if (!email) {
        store.getState().limpiar();
        return;
      }
      await aplicarLogin(api, store, await api.auth.login({ email, password: nueva }));
    },
  });
}

export function useIniciarMfa() {
  const api = useApi();
  return useMutation({ mutationFn: () => api.auth.iniciarMfa() });
}

/** Activar el MFA cierra las sesiones abiertas: después de mostrar los códigos, se vuelve a entrar. */
export function useActivarMfa() {
  const api = useApi();
  return useMutation({ mutationFn: (codigo: string) => api.auth.activarMfa(codigo) });
}

export function useCerrarSesion() {
  const api = useApi();
  const store = useContextoSesion();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const refresh = store.getState().refreshToken();
      if (refresh) await api.auth.logout(refresh);
    },
    // Aunque el servidor no responda, la sesión local se cierra y se borra la caché.
    onSettled: () => {
      store.getState().limpiar();
      queryClient.clear();
    },
  });
}
