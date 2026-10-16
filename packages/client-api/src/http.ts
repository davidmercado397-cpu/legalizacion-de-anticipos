import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { ApiError } from './errores';

/** Lo que el cliente HTTP necesita saber de la sesión; lo implementa cada app (web: Zustand + localStorage). */
export interface PuertoSesion {
  accessToken(): string | null;
  /** Renueva el access token con el refresh token guardado. Devuelve null si no hay sesión. */
  renovar(): Promise<string | null>;
  /** La sesión no se pudo renovar: la app debe llevar al login. */
  expirada(): void;
}

export interface OpcionesClienteHttp {
  baseURL: string;
  sesion: PuertoSesion;
  idioma?: () => string;
  timeoutMs?: number;
}

type ConfigConReintento = InternalAxiosRequestConfig & { _reintentado?: boolean };

/**
 * Instancia axios con:
 * - Authorization: Bearer y Accept-Language en cada petición.
 * - Renovación transparente del access token ante un 401, con una sola renovación
 *   en vuelo aunque fallen varias peticiones a la vez (single-flight).
 * - Errores normalizados a ApiError.
 */
export function crearClienteHttp(opciones: OpcionesClienteHttp): AxiosInstance {
  const http = axios.create({
    baseURL: opciones.baseURL,
    timeout: opciones.timeoutMs ?? 30_000,
  });

  let renovacionEnCurso: Promise<string | null> | null = null;
  const renovarUnaVez = () => {
    renovacionEnCurso ??= opciones.sesion.renovar().finally(() => {
      renovacionEnCurso = null;
    });
    return renovacionEnCurso;
  };

  http.interceptors.request.use((config) => {
    const token = opciones.sesion.accessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    if (opciones.idioma) config.headers['Accept-Language'] = opciones.idioma();
    return config;
  });

  http.interceptors.response.use(undefined, async (error: unknown) => {
    const apiError = ApiError.desde(error);
    const config = (error as { config?: ConfigConReintento }).config;
    const esRutaAuth = config?.url?.includes('/auth/') ?? false;

    if (apiError.status === 401 && config && !config._reintentado && !esRutaAuth) {
      config._reintentado = true;
      const nuevoToken = await renovarUnaVez().catch(() => null);
      if (nuevoToken) {
        config.headers.Authorization = `Bearer ${nuevoToken}`;
        return http.request(config);
      }
      opciones.sesion.expirada();
    }
    throw apiError;
  });

  return http;
}
