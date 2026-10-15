/**
 * Normalizaciones para comparar datos leídos por OCR o digitados de formas distintas.
 * (La de NIT/CNPJ vive en el shared-kernel: también la usa la legalización.)
 */
export { normalizarIdentificacionTributaria } from '@viaticos/shared-kernel';

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
