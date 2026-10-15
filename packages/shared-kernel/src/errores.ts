/**
 * Categoría de un error de dominio. La capa de presentación la traduce a un
 * código HTTP; el dominio no conoce HTTP.
 */
export type TipoErrorDominio =
  | 'VALIDACION'
  | 'NO_ENCONTRADO'
  | 'NO_AUTORIZADO'
  | 'CONFLICTO'
  | 'REGLA_NEGOCIO';

export class DomainError extends Error {
  constructor(
    readonly codigo: string,
    readonly tipo: TipoErrorDominio,
    mensaje: string,
    readonly detalles: Record<string, unknown> = {},
  ) {
    super(mensaje);
    this.name = 'DomainError';
  }
}

export function invariante(
  condicion: unknown,
  codigo: string,
  mensaje: string,
  detalles: Record<string, unknown> = {},
): asserts condicion {
  if (!condicion) throw new DomainError(codigo, 'VALIDACION', mensaje, detalles);
}
