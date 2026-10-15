import { createHash } from 'node:crypto';
import { DomainError } from '@viaticos/shared-kernel';

export const TAMANO_MAXIMO_ARCHIVO = 10 * 1024 * 1024;

const FIRMAS: Array<{ mime: string; ext: string; coincide: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', ext: 'jpg', coincide: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', coincide: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', coincide: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', coincide: (b) => b.toString('ascii', 0, 5) === '%PDF-' },
];

/**
 * Tipo real del archivo por su contenido (no por la extensión ni el Content-Type
 * que envía el cliente). Solo se aceptan JPEG, PNG, WEBP y PDF.
 */
export function inspeccionarArchivo(contenido: Buffer): { mime: string; ext: string; sha256: string } {
  if (contenido.length === 0) throw new DomainError('ARCHIVO_VACIO', 'VALIDACION', 'El archivo está vacío');
  if (contenido.length > TAMANO_MAXIMO_ARCHIVO) {
    throw new DomainError('ARCHIVO_DEMASIADO_GRANDE', 'VALIDACION', 'El archivo supera 10 MB');
  }
  const tipo = FIRMAS.find((f) => f.coincide(contenido));
  if (!tipo) {
    throw new DomainError('TIPO_ARCHIVO_NO_PERMITIDO', 'VALIDACION', 'Solo se aceptan fotos (JPG, PNG, WEBP) o PDF');
  }
  return { mime: tipo.mime, ext: tipo.ext, sha256: createHash('sha256').update(contenido).digest('hex') };
}
