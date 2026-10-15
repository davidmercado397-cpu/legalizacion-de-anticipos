import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LoginRequest } from '@viaticos/contracts';
import { useApi, useSesion } from '../contexto';

export function useIniciarSesion() {
  const api = useApi();
  const establecer = useSesion((s) => s.establecer);
  return useMutation({
    mutationFn: (datos: LoginRequest) => api.auth.login(datos),
    onSuccess: establecer,
  });
}

export function useCerrarSesion() {
  const api = useApi();
  const limpiar = useSesion((s) => s.limpiar);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.auth.logout(),
    // Aunque el servidor no responda, la sesión local se cierra y se borra la caché.
    onSettled: () => {
      limpiar();
      queryClient.clear();
    },
  });
}
