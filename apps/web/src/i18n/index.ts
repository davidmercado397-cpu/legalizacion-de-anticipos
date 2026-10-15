import { es } from './es';

/**
 * Traducción mínima por claves (validation.*, estado.*, error.*).
 * Las claves son las mismas que emiten los esquemas Zod de @viaticos/contracts y la API,
 * así que migrar a i18next con pt/en solo cambia este archivo.
 */
export function t(clave: string): string {
  return es[clave] ?? clave;
}
