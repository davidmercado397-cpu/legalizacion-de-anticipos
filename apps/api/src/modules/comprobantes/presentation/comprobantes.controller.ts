import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import {
  verificarDuplicadoRequestSchema,
  type ResultadoDuplicidadResponse,
  type VerificarDuplicadoRequest,
} from '@viaticos/contracts';
import { UsuarioActual } from '../../../shared/presentation/autenticacion';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { ControlDuplicados } from '../application/control-duplicados';
import type { ResultadoDuplicidad } from '../domain/duplicados/detector-duplicados';

const OTRO_USUARIO = 'OTRO_USUARIO';

/**
 * Un viajero no debe saber quién más radicó una factura: los datos de
 * comprobantes ajenos se ocultan (contabilidad tendrá su propia vista).
 */
export function presentarDuplicidad(r: ResultadoDuplicidad, usuarioId: string): ResultadoDuplicidadResponse {
  return {
    veredicto: r.veredicto,
    coincidencias: r.coincidencias.map((c) =>
      c.viajeroId === usuarioId ? c : { ...c, comprobanteId: OTRO_USUARIO, viajeroId: OTRO_USUARIO },
    ),
  };
}

@Controller('comprobantes')
export class ComprobantesController {
  constructor(@Inject(ControlDuplicados) private readonly duplicados: ControlDuplicados) {}

  /** Pre-chequeo barato: el cliente envía el SHA-256 antes de subir la imagen. */
  @Post('duplicados/verificar')
  @HttpCode(200)
  async verificarDuplicado(
    @UsuarioActual() usuarioId: string,
    @Body(new ZodValidationPipe(verificarDuplicadoRequestSchema)) body: VerificarDuplicadoRequest,
  ): Promise<ResultadoDuplicidadResponse> {
    const { comprobanteId, ...datos } = body;
    return presentarDuplicidad(await this.duplicados.verificar(datos, comprobanteId), usuarioId);
  }
}
