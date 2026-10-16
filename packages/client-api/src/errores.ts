import { isAxiosError } from 'axios';
import type { CuerpoError } from '@viaticos/contracts';

function esCuerpoError(valor: unknown): valor is CuerpoError {
  const error = (valor as CuerpoError | null)?.error;
  return typeof error?.code === 'string' && typeof error.message === 'string';
}

/** Error de la API normalizado desde {"error": {code, message, details, request_id}}. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Código estable (ej. `pending_expenses`); la lógica del cliente decide con él, nunca con el mensaje. */
    readonly codigo: string,
    /** Texto en español, listo para mostrar. */
    mensaje: string,
    /** Errores 422 por campo: `{ email: ["Este campo es obligatorio."] }`. */
    readonly erroresCampo: Record<string, string[]> = {},
    readonly requestId: string | null = null,
    /** Segundos de espera en 423 y 429. */
    readonly reintentarEn: number | null = null,
    /** El detalle tal cual (p. ej. la fila del Excel con cada problema). */
    readonly detalles: Record<string, unknown>[] = [],
  ) {
    super(mensaje);
    this.name = 'ApiError';
  }

  static desde(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (isAxiosError(error)) {
      if (!error.response) return new ApiError(0, 'sin_conexion', 'No hay conexión con el servidor.');
      const { status, data, headers } = error.response;
      const espera = Number((headers as Record<string, unknown>)['retry-after']);
      if (esCuerpoError(data)) {
        const campos: Record<string, string[]> = {};
        for (const detalle of data.error.details) {
          if (typeof detalle.field === 'string' && typeof detalle.issue === 'string') {
            (campos[detalle.field] ??= []).push(detalle.issue);
          }
        }
        return new ApiError(
          status,
          data.error.code,
          data.error.message,
          campos,
          data.error.request_id,
          Number.isFinite(espera) ? espera : null,
          data.error.details as Record<string, unknown>[],
        );
      }
      // 502/503/504 sin el cuerpo de la API: lo responde un proxy (Vite, nginx) porque la API no está arriba.
      if ([502, 503, 504].includes(status)) return new ApiError(status, 'servidor_no_disponible', 'El servidor no está disponible.');
      return new ApiError(status, `http_${status}`, error.message);
    }
    return new ApiError(0, 'error_desconocido', error instanceof Error ? error.message : String(error));
  }
}
