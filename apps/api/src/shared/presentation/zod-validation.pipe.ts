import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class EntradaInvalidaError extends Error {
  constructor(readonly errores: Record<string, string[]>) {
    super('La solicitud contiene datos inválidos');
    this.name = 'EntradaInvalidaError';
  }
}

/** Valida y transforma la entrada con los esquemas compartidos de @viaticos/contracts. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(valor: unknown): z.output<S> {
    const resultado = this.schema.safeParse(valor);
    if (resultado.success) return resultado.data;

    const errores: Record<string, string[]> = {};
    for (const issue of resultado.error.issues) {
      const ruta = issue.path.join('.') || '_';
      (errores[ruta] ??= []).push(issue.message);
    }
    throw new EntradaInvalidaError(errores);
  }
}
