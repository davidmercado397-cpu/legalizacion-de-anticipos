import { ApiError } from '@viaticos/client-api';
import { t } from '../i18n';

/** Mensaje para el usuario: traducción del código estable de la API, o el título que envió el servidor. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) {
    const clave = `error.${error.codigo}`;
    const traducido = t(clave);
    return traducido !== clave ? traducido : error.message;
  }
  return 'Ocurrió un error inesperado.';
}
