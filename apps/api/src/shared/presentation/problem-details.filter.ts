import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ProblemDetails } from '@viaticos/contracts';
import { DomainError, type TipoErrorDominio } from '@viaticos/shared-kernel';
import type { Response } from 'express';
import { EntradaInvalidaError } from './zod-validation.pipe';

const STATUS_POR_TIPO: Record<TipoErrorDominio, number> = {
  VALIDACION: 422,
  NO_AUTENTICADO: 401,
  REGLA_NEGOCIO: 422,
  NO_ENCONTRADO: 404,
  NO_AUTORIZADO: 403,
  CONFLICTO: 409,
};

/** Traduce cualquier error a application/problem+json (RFC 7807). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const problema = this.aProblema(error);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(problema.status)
      .type('application/problem+json')
      .json(problema);
  }

  private aProblema(error: unknown): ProblemDetails {
    if (error instanceof DomainError) {
      return {
        type: `urn:viaticos:error:${error.codigo}`,
        title: error.message,
        status: STATUS_POR_TIPO[error.tipo],
        code: error.codigo,
        meta: error.detalles,
      };
    }
    if (error instanceof EntradaInvalidaError) {
      return {
        type: 'urn:viaticos:error:ENTRADA_INVALIDA',
        title: error.message,
        status: 400,
        code: 'ENTRADA_INVALIDA',
        errors: error.errores,
      };
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const codigo =
        status === 401 ? 'NO_AUTENTICADO' : status === 403 ? 'SIN_PERMISO' : status === 404 ? 'RUTA_NO_ENCONTRADA' : `HTTP_${status}`;
      return { type: `urn:viaticos:error:${codigo}`, title: error.message, status, code: codigo };
    }
    this.logger.error(error instanceof Error ? error.stack : String(error));
    return {
      type: 'urn:viaticos:error:ERROR_INTERNO',
      title: 'Ocurrió un error inesperado',
      status: 500,
      code: 'ERROR_INTERNO',
    };
  }
}
