import { ApiError } from '@viaticos/client-api';

/** La API ya responde en español y listo para mostrar; ante un error interno se agrega su referencia. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status >= 500 && error.requestId ? `${error.message} (referencia ${error.requestId.slice(0, 8)})` : error.message;
  }
  return 'Ocurrió un error inesperado.';
}

/** Errores por campo que mandó la API (validación), para mostrarlos junto a cada campo. */
export function erroresDeCampo(error: unknown): Record<string, string[]> {
  return error ? ApiError.desde(error).erroresCampo : {};
}

/** El código estable del error de negocio (p. ej. `escalation_justification_required`), si lo hay. */
export function codigoDeError(error: unknown): string | undefined {
  return error instanceof ApiError ? error.codigo : undefined;
}

/** Los detalles del error (p. ej. las filas con problemas de un Excel importado). */
export function detallesDeError(error: unknown): Record<string, unknown>[] {
  return error ? [...ApiError.desde(error).detalles] : [];
}
