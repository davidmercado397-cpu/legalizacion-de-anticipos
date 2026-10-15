/**
 * Normalizaciones para comparar datos leídos por OCR o digitados de formas distintas.
 */

/**
 * NIT / CNPJ / Tax ID → solo caracteres alfanuméricos en mayúscula.
 * Un NIT con dígito de verificación separado por guion ("900.123.456-7") se
 * compara sin el DV, porque el OCR a veces lo omite.
 */
export function normalizarIdentificacionTributaria(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const sinSeparadores = valor.replace(/[\s.]/g, '');
  const nitConDv = /^(\d+)-\d$/.exec(sinSeparadores);
  const normalizado = (nitConDv ? nitConDv[1]! : sinSeparadores).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return normalizado || null;
}

/**
 * Número de factura → prefijo + consecutivo sin separadores ni ceros a la izquierda.
 * "FE-000123", "fe 123" y "FE123" se consideran el mismo documento.
 */
export function normalizarNumeroDocumento(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpio = valor.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const partes = /^([A-Z]*)0*(\d+)$/.exec(limpio);
  const normalizado = partes ? `${partes[1]}${partes[2]}` : limpio;
  return normalizado || null;
}
