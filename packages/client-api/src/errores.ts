import { isAxiosError } from 'axios';
import { problemDetailsSchema } from '@viaticos/contracts';

/** Error de la API normalizado desde application/problem+json (RFC 7807). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Código estable para i18n y lógica del cliente (ej. JUSTIFICACION_REQUERIDA). */
    readonly codigo: string,
    mensaje: string,
    /** Errores por campo (ruta "destinos.0.fechaFin" → claves i18n). */
    readonly erroresCampo: Record<string, string[]> = {},
    readonly meta: Record<string, unknown> = {},
  ) {
    super(mensaje);
    this.name = 'ApiError';
  }

  static desde(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (isAxiosError(error)) {
      if (!error.response) return new ApiError(0, 'SIN_CONEXION', 'No hay conexión con el servidor');
      const problema = problemDetailsSchema.safeParse(error.response.data);
      if (problema.success) {
        const p = problema.data;
        return new ApiError(p.status, p.code, p.title, p.errors ?? {}, p.meta ?? {});
      }
      // 502/503/504 sin problem+json: lo responde un proxy (Vite, nginx) porque la API no está disponible.
      if ([502, 503, 504].includes(error.response.status)) {
        return new ApiError(error.response.status, 'SERVIDOR_NO_DISPONIBLE', 'El servidor no está disponible');
      }
      return new ApiError(error.response.status, `HTTP_${error.response.status}`, error.message);
    }
    return new ApiError(0, 'ERROR_DESCONOCIDO', error instanceof Error ? error.message : String(error));
  }
}
