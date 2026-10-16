import { Body, Controller, HttpCode, Inject, Param, Put } from '@nestjs/common';
import { contrasenaRequestSchema } from '@viaticos/contracts';
import type { z } from 'zod';
import { Roles } from '../../../shared/presentation/autenticacion';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { EstablecerContrasenaUseCase } from '../application/sesiones.use-cases';

/** El administrador asigna (o restablece) la contraseña de un usuario local. */
@Controller('administracion/usuarios')
export class CredencialesController {
  constructor(
    @Inject(EstablecerContrasenaUseCase) private readonly establecer: EstablecerContrasenaUseCase,
  ) {}

  @Put(':id/contrasena')
  @Roles('ADMIN')
  @HttpCode(204)
  async asignar(@Param('id') id: string, @Body(new ZodValidationPipe(contrasenaRequestSchema)) body: z.output<typeof contrasenaRequestSchema>) {
    await this.establecer.ejecutar(id, body.contrasena);
  }
}
