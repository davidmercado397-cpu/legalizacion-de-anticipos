import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import {
  configuracionEscalamientoSchema,
  type ConfiguracionEscalamientoResponse,
} from '@viaticos/contracts';
import type { z } from 'zod';
import { Roles, UsuarioActual } from '../../../shared/presentation/autenticacion';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import type { DirectorioOrganizacional } from '../application/puertos';
import { ConfigurarEscalamientoUseCase } from '../application/configurar-escalamiento.use-case';
import type { ConfiguracionReglaEscalamiento } from '../domain/escalamiento/fabrica-reglas';
import { DIRECTORIO_ORGANIZACIONAL } from '../solicitudes.tokens';

type Formulario = z.output<typeof configuracionEscalamientoSchema>;

const aReglas = (f: Formulario): ConfiguracionReglaEscalamiento[] => [
  { tipo: 'EXCEDE_TARIFA', activa: f.excedeTarifa.activa, parametros: { toleranciaPorcentaje: f.excedeTarifa.toleranciaPorcentaje } },
  {
    tipo: 'MONTO_TOTAL_SUPERA',
    activa: f.montoTotal.activa,
    parametros: {
      umbrales: [
        { monto: f.montoTotal.umbralUsd, moneda: 'USD' },
        { monto: f.montoTotal.umbralCop, moneda: 'COP' },
      ],
    },
  },
];

@Controller('configuracion-escalamiento')
export class ConfiguracionEscalamientoController {
  constructor(
    @Inject(ConfigurarEscalamientoUseCase) private readonly configurar: ConfigurarEscalamientoUseCase,
    @Inject(DIRECTORIO_ORGANIZACIONAL) private readonly directorio: DirectorioOrganizacional,
  ) {}

  @Get()
  async obtener(): Promise<ConfiguracionEscalamientoResponse> {
    return this.presentar(await this.configurar.obtener());
  }

  @Put()
  @Roles('CONTABILIDAD')
  async actualizar(
    @UsuarioActual() usuarioId: string,
    @Body(new ZodValidationPipe(configuracionEscalamientoSchema)) body: Formulario,
  ): Promise<ConfiguracionEscalamientoResponse> {
    return this.presentar(await this.configurar.actualizar(aReglas(body), usuarioId));
  }

  private async presentar(c: Awaited<ReturnType<ConfigurarEscalamientoUseCase['obtener']>>): Promise<ConfiguracionEscalamientoResponse> {
    const tarifa = c.reglas.find((r) => r.tipo === 'EXCEDE_TARIFA');
    const monto = c.reglas.find((r) => r.tipo === 'MONTO_TOTAL_SUPERA');
    const umbral = (moneda: string) => (monto?.tipo === 'MONTO_TOTAL_SUPERA' ? monto.parametros.umbrales.find((u) => u.moneda === moneda)?.monto : undefined);
    const nombres = c.actualizadoPor ? await this.directorio.nombres([c.actualizadoPor]) : new Map<string, string>();
    return {
      excedeTarifa: {
        activa: tarifa?.activa ?? false,
        toleranciaPorcentaje: tarifa?.tipo === 'EXCEDE_TARIFA' ? tarifa.parametros.toleranciaPorcentaje : 0,
      },
      montoTotal: { activa: monto?.activa ?? false, umbralUsd: umbral('USD') ?? '0', umbralCop: umbral('COP') ?? '0' },
      actualizadoPorNombre: c.actualizadoPor ? (nombres.get(c.actualizadoPor) ?? c.actualizadoPor) : null,
      actualizadoEn: c.actualizadoEn?.toISOString() ?? null,
    };
  }
}
