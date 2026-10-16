import { es } from './es';

/** Traducción mínima por claves; migrar a i18next con pt/en solo cambia este archivo. */
export function t(clave: string): string {
  return es[clave] ?? clave;
}

/** Texto de un valor de la API: etiqueta('anticipo', 'approved') → "Aprobado · por legalizar". */
export function etiqueta(grupo: string, valor: string | null | undefined): string {
  if (!valor) return '—';
  return es[`${grupo}.${valor}`] ?? valor;
}
