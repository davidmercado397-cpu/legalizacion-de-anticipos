import type { SesionResponse, UsuarioSesion } from '@viaticos/contracts';
import { createStore } from 'zustand/vanilla';

export type EstadoAutenticacion = 'restaurando' | 'autenticada' | 'anonima';

export interface EstadoSesion {
  estado: EstadoAutenticacion;
  /** Solo en memoria: nunca en localStorage (mitiga robo por XSS). */
  accessToken: string | null;
  usuario: UsuarioSesion | null;
  establecer(sesion: SesionResponse): void;
  limpiar(): void;
}

/** Store "vanilla": se usa desde React (useSesion) y fuera de él (guards del router, cliente HTTP). */
export const crearSesionStore = () =>
  createStore<EstadoSesion>()((set) => ({
    estado: 'restaurando',
    accessToken: null,
    usuario: null,
    establecer: (sesion) => set({ estado: 'autenticada', accessToken: sesion.accessToken, usuario: sesion.usuario }),
    limpiar: () => set({ estado: 'anonima', accessToken: null, usuario: null }),
  }));

export type SesionStore = ReturnType<typeof crearSesionStore>;
