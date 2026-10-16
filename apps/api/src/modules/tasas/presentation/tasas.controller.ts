import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { TasasDelDiaResponse } from '@viaticos/contracts';
import { FechaCalendario } from '@viaticos/shared-kernel';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { TasasDelDia } from '../application/tasas-del-dia';

const consulta = z.object({ fecha: z.iso.date().optional() });

@Controller('tasas')
export class TasasController {
  constructor(@Inject(TasasDelDia) private readonly tasas: TasasDelDia) {}

  /** Tasas por dólar vigentes hoy (o en `fecha`), con su fuente. */
  @Get()
  async delDia(@Query(new ZodValidationPipe(consulta)) q: z.output<typeof consulta>): Promise<TasasDelDiaResponse> {
    return this.tasas.consultar(q.fecha ? FechaCalendario.of(q.fecha) : undefined);
  }
}
