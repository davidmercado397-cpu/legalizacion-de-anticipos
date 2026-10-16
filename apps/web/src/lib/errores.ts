import { ApiError } from '@viaticos/client-api';

/** La API ya responde en español y listo para mostrar; ante un error interno se agrega su referencia. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status >= 500 && error.requestId ? `${error.message} (referencia ${error.requestId.slice(0, 8)})` : error.message;
  }
  return 'Ocurrió un error inesperado.';
}
