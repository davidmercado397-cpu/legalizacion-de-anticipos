import type { Perfil } from '@viaticos/client-api';
import { createStore } from 'zustand/vanilla';

/**
 * - restaurando: al abrir la app, mientras se intenta recuperar la sesión guardada.
 * - mfa: la contraseña fue correcta y falta el código de verificación en dos pasos.
 * - autenticada: con usuario; aun así puede tener pendiente cambiar la clave o activar el MFA.
 */
export type EstadoAutenticacion = 'restaurando' | 'anonima' | 'mfa' | 'autenticada';

/** Dónde vive el refresh token entre visitas (web: localStorage; móvil: almacenamiento seguro). */
export interface AlmacenSesion {
  leer(): string | null;
  guardar(refreshToken: string | null): void;
}

export const almacenEnMemoria = (): AlmacenSesion => {
  let valor: string | null = null;
  return { leer: () => valor, guardar: (v) => void (valor = v) };
};

export interface EstadoSesion {
  estado: EstadoAutenticacion;
  /** El access token vive solo en memoria (dura minutos). */
  accessToken: string | null;
  usuario: Perfil | null;
  mfaToken: string | null;
  refreshToken(): string | null;
  establecerTokens(accessToken: string, refreshToken: string): void;
  establecerUsuario(usuario: Perfil): void;
  pedirMfa(mfaToken: string): void;
  limpiar(): void;
}

/** Store "vanilla": se usa desde React (useSesion) y fuera de él (guards del router, cliente HTTP). */
export const crearSesionStore = (almacen: AlmacenSesion = almacenEnMemoria()) =>
  createStore<EstadoSesion>()((set) => ({
    estado: 'restaurando',
    accessToken: null,
    usuario: null,
    mfaToken: null,
    refreshToken: () => almacen.leer(),
    establecerTokens: (accessToken, refreshToken) => {
      almacen.guardar(refreshToken);
      set({ accessToken, mfaToken: null });
    },
    establecerUsuario: (usuario) => set({ estado: 'autenticada', usuario }),
    pedirMfa: (mfaToken) => set({ estado: 'mfa', mfaToken, accessToken: null, usuario: null }),
    limpiar: () => {
      almacen.guardar(null);
      set({ estado: 'anonima', accessToken: null, usuario: null, mfaToken: null });
    },
  }));

export type SesionStore = ReturnType<typeof crearSesionStore>;

/** Lo que el usuario debe hacer antes de usar la app (la API responde 403 hasta entonces). */
export function pendienteDe(usuario: Perfil | null): 'cambiar_clave' | 'activar_mfa' | null {
  if (usuario?.must_change_password) return 'cambiar_clave';
  if (usuario?.mfa_setup_required) return 'activar_mfa';
  return null;
}
