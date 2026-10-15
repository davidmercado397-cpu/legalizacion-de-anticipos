import type { Api } from '@viaticos/client-api';
import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { EstadoSesion, SesionStore } from './sesion/sesion.store';

interface ContextoCliente {
  api: Api;
  sesion: SesionStore;
}

const Contexto = createContext<ContextoCliente | null>(null);

/** Inyección de dependencias: en pruebas se pasa una Api falsa; en móvil, otra configuración. */
export function ClienteProvider({ api, sesion, children }: ContextoCliente & { children: ReactNode }) {
  return <Contexto.Provider value={{ api, sesion }}>{children}</Contexto.Provider>;
}

function useContexto(): ContextoCliente {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('Falta <ClienteProvider>');
  return ctx;
}

export const useApi = (): Api => useContexto().api;

export function useSesion<T>(selector: (estado: EstadoSesion) => T): T {
  return useStore(useContexto().sesion, selector);
}
