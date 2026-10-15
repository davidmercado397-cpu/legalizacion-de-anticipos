import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  estadoAnticipoSchema,
  registrarDesembolsoRequestSchema,
  type AnticipoResponse,
  type MedioDesembolso,
} from '@viaticos/contracts';
import { z } from 'zod';
import { Roles, RolesUsuario, UsuarioActual } from '../../../shared/presentation/autenticacion';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { GestionAnticipos } from '../application/anticipos.use-cases';
import { PresentadorAnticipos } from './anticipo.presenter';

const filtroEstados = z.object({
  estado: z
    .union([estadoAnticipoSchema, z.array(estadoAnticipoSchema)])
    .optional()
    .transform((e) => (e === undefined ? ['PENDIENTE_ERP', 'POR_DESEMBOLSAR'] as const : [e].flat())),
});

@Controller('anticipos')
export class AnticiposController {
  constructor(
    @Inject(GestionAnticipos) private readonly anticipos: GestionAnticipos,
    @Inject(PresentadorAnticipos) private readonly presentar: PresentadorAnticipos,
  ) {}

  @Get('mios')
  async mios(@UsuarioActual() usuarioId: string): Promise<AnticipoResponse[]> {
    return this.presentar.varios(await this.anticipos.listarDelViajero(usuarioId));
  }

  /** Bandeja de tesorería (por defecto: pendientes de ERP y por desembolsar). */
  @Get()
  @Roles('TESORERIA', 'CONTABILIDAD')
  async porEstado(@Query(new ZodValidationPipe(filtroEstados)) filtro: z.output<typeof filtroEstados>): Promise<AnticipoResponse[]> {
    return this.presentar.varios(await this.anticipos.listarPorEstados(filtro.estado));
  }

  @Get(':id')
  async obtener(
    @UsuarioActual() usuarioId: string,
    @RolesUsuario() roles: string[],
    @Param('id') id: string,
  ): Promise<AnticipoResponse> {
    return this.presentar.uno(await this.anticipos.obtenerPara(id, usuarioId, roles));
  }

  @Post(':id/desembolso')
  @Roles('TESORERIA')
  @HttpCode(200)
  async desembolsar(
    @UsuarioActual() tesoreroId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(registrarDesembolsoRequestSchema))
    body: { fecha: string; medio: MedioDesembolso; referencia?: string },
  ): Promise<AnticipoResponse> {
    return this.presentar.uno(await this.anticipos.registrarDesembolso({ anticipoId: id, tesoreroId, ...body }));
  }

  @Post(':id/reintentar-erp')
  @Roles('TESORERIA')
  @HttpCode(200)
  async reintentarErp(@Param('id') id: string): Promise<AnticipoResponse> {
    return this.presentar.uno(await this.anticipos.registrarEnErp(id));
  }
}
