import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  cierreTarifaRequestSchema,
  conceptoSchema,
  tarifaRequestSchema,
  type ConceptoResponse,
  type TarifaResponse,
} from '@viaticos/contracts';
import { z } from 'zod';
import { Roles } from '../../../shared/presentation/autenticacion';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { AdministrarTarifasUseCase } from '../application/administrar-tarifas.use-case';
import type { Tarifa } from '../domain/tarifa';

const presentar = (t: Tarifa): TarifaResponse => ({
  id: t.id,
  cargoId: t.cargoId,
  paisCodigo: t.paisCodigo,
  conceptoCodigo: t.conceptoCodigo,
  valor: t.valorUnitario.toDto(),
  vigenteDesde: t.vigenteDesde.toString(),
  vigenteHasta: t.vigenteHasta?.toString() ?? null,
});
const filtro = z.object({ cargoId: z.string().optional(), paisCodigo: z.string().optional() });

/** Contabilidad administra conceptos de viático y la matriz de tarifas. */
@Controller('administracion')
@Roles('CONTABILIDAD')
export class AdministracionTarifasController {
  constructor(@Inject(AdministrarTarifasUseCase) private readonly admin: AdministrarTarifasUseCase) {}

  @Get('conceptos')
  conceptos(): Promise<ConceptoResponse[]> {
    return this.admin.listarConceptos();
  }

  @Post('conceptos')
  guardarConcepto(@Body(new ZodValidationPipe(conceptoSchema)) body: z.output<typeof conceptoSchema>): Promise<ConceptoResponse> {
    return this.admin.guardarConcepto(body);
  }

  @Get('tarifas')
  async tarifas(@Query(new ZodValidationPipe(filtro)) f: z.output<typeof filtro>): Promise<TarifaResponse[]> {
    return (await this.admin.listarTarifas(f)).map(presentar);
  }

  @Post('tarifas')
  async crearTarifa(@Body(new ZodValidationPipe(tarifaRequestSchema)) body: z.output<typeof tarifaRequestSchema>): Promise<TarifaResponse> {
    return presentar(await this.admin.crearTarifa(body));
  }

  @Post('tarifas/:id/cierre')
  async cerrarTarifa(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cierreTarifaRequestSchema)) body: z.output<typeof cierreTarifaRequestSchema>,
  ): Promise<TarifaResponse> {
    return presentar(await this.admin.cerrarTarifa(id, body.vigenteHasta));
  }
}
