import { FechaCalendario, Money, invariante, type MoneyDto } from '@viaticos/shared-kernel';
import { ClaveFiscal, type TipoClaveFiscal } from '../clave-fiscal';
import { normalizarIdentificacionTributaria, normalizarNumeroDocumento } from './normalizacion';

export interface DatosHuella {
  sha256: string;
  hashPerceptual?: string | null | undefined;
  claveFiscal?: { tipo: TipoClaveFiscal; valor: string } | null | undefined;
  emisorId?: string | null | undefined;
  numeroDocumento?: string | null | undefined;
  fecha?: string | null | undefined;
  total?: MoneyDto | null | undefined;
}

/**
 * Señales normalizadas de un comprobante para detectar duplicados.
 * Solo el SHA-256 es obligatorio: está disponible desde la carga, antes del OCR.
 */
export class HuellaComprobante {
  private constructor(
    readonly sha256: string,
    readonly hashPerceptual: string | null,
    readonly claveFiscal: ClaveFiscal | null,
    readonly emisorId: string | null,
    readonly numeroDocumento: string | null,
    readonly fecha: FechaCalendario | null,
    readonly total: Money | null,
  ) {}

  static crear(datos: DatosHuella): HuellaComprobante {
    const sha256 = datos.sha256.trim().toLowerCase();
    invariante(/^[0-9a-f]{64}$/.test(sha256), 'SHA256_INVALIDO', 'Hash SHA-256 inválido');
    const hashPerceptual = datos.hashPerceptual?.trim().toLowerCase() || null;
    invariante(
      hashPerceptual === null || /^[0-9a-f]{16}$/.test(hashPerceptual),
      'HASH_PERCEPTUAL_INVALIDO',
      'Hash perceptual inválido (se esperan 64 bits en hexadecimal)',
    );

    return new HuellaComprobante(
      sha256,
      hashPerceptual,
      datos.claveFiscal ? ClaveFiscal.crear(datos.claveFiscal.tipo, datos.claveFiscal.valor) : null,
      normalizarIdentificacionTributaria(datos.emisorId),
      normalizarNumeroDocumento(datos.numeroDocumento),
      datos.fecha ? FechaCalendario.of(datos.fecha) : null,
      datos.total ? Money.fromDto(datos.total) : null,
    );
  }
}

/** Bits distintos entre dos hashes perceptuales de 64 bits. */
export function distanciaHamming(a: string, b: string): number {
  let diferencia = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let bits = 0;
  while (diferencia > 0n) {
    bits += Number(diferencia & 1n);
    diferencia >>= 1n;
  }
  return bits;
}
