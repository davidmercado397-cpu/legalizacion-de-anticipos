import { Controller, Get } from '@nestjs/common';
import { Publico } from './shared/presentation/autenticacion';

@Controller('salud')
export class SaludController {
  @Get()
  @Publico()
  verificar() {
    return { estado: 'ok' };
  }
}
