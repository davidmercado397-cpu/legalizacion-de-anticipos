import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  confirmarSoporteRequestSchema,
  decisionLineaRequestSchema,
  decisionSoporteRequestSchema,
  devolverLegalizacionRequestSchema,
  estadoLegalizacionSchema,
  politicaLegalizacionSchema,
  reciboCajaRequestSchema,
  subirSoporteRequestSchema,
  type LegalizacionResponse,
  type PoliticaLegalizacionResponse,
} from '@viaticos/contracts';
import { DomainError } from '@viaticos/shared-kernel';
import type { Response } from 'express';
import { z } from 'zod';
import { Roles, RolesUsuario, UsuarioActual } from '../../../shared/presentation/autenticacion';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { TAMANO_MAXIMO_ARCHIVO } from '../application/archivos';
import { GestionLegalizaciones } from '../application/legalizaciones.use-cases';
import { PresentadorLegalizaciones, presentarPolitica } from './legalizacion.presenter';

const SUBIDA = FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO_ARCHIVO, files: 1, fields: 20 } });
const filtroEstados = z.object({
  estado: z
    .union([estadoLegalizacionSchema, z.array(estadoLegalizacionSchema)])
    .optional()
    .transform((e) => (e === undefined ? (['EN_REVISION'] as const) : [e].flat())),
});

const exigirArchivo = (archivo: Express.Multer.File | undefined) => {
  if (!archivo) throw new DomainError('ARCHIVO_REQUERIDO', 'VALIDACION', 'Adjunte la foto o el PDF de la factura');
  return { nombre: archivo.originalname, contenido: archivo.buffer };
};

@Controller()
export class LegalizacionesController {
  constructor(
    @Inject(GestionLegalizaciones) private readonly gestion: GestionLegalizaciones,
    @Inject(PresentadorLegalizaciones) private readonly presentar: PresentadorLegalizaciones,
  ) {}

  @Get('legalizaciones/por-anticipo/:anticipoId')
  async porAnticipo(@UsuarioActual() u: string, @RolesUsuario() roles: string[], @Param('anticipoId') anticipoId: string): Promise<LegalizacionResponse> {
    return this.presentar.una(await this.gestion.obtenerPorAnticipo(anticipoId, u, roles));
  }

  /** Bandeja de contabilidad (por defecto: en revisión). Tesorería la usa para cargar extractos. */
  @Get('legalizaciones')
  @Roles('CONTABILIDAD', 'TESORERIA')
  async porEstado(@Query(new ZodValidationPipe(filtroEstados)) filtro: z.output<typeof filtroEstados>): Promise<LegalizacionResponse[]> {
    return this.presentar.varias(await this.gestion.listarPorEstados(filtro.estado));
  }

  @Get('legalizaciones/:id')
  async obtener(@UsuarioActual() u: string, @RolesUsuario() roles: string[], @Param('id') id: string): Promise<LegalizacionResponse> {
    return this.presentar.una(await this.gestion.obtenerPara(id, u, roles));
  }

  // ---------- Viajero ----------

  @Post('legalizaciones/:id/soportes')
  @UseInterceptors(SUBIDA)
  async subirFactura(
    @UsuarioActual() u: string,
    @Param('id') id: string,
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(subirSoporteRequestSchema)) body: { descripcion: string },
  ): Promise<LegalizacionResponse> {
    const l = await this.gestion.subirFactura({ legalizacionId: id, usuarioId: u, descripcion: body.descripcion, archivo: exigirArchivo(archivo) });
    return this.presentar.una(l);
  }

  @Post('legalizaciones/:id/recibos-caja')
  @UseInterceptors(SUBIDA)
  async reciboCaja(
    @UsuarioActual() u: string,
    @Param('id') id: string,
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(reciboCajaRequestSchema)) recibo: z.output<typeof reciboCajaRequestSchema>,
  ): Promise<LegalizacionResponse> {
    const l = await this.gestion.agregarReciboCaja({
      legalizacionId: id,
      usuarioId: u,
      recibo,
      archivo: archivo ? { nombre: archivo.originalname, contenido: archivo.buffer } : null,
    });
    return this.presentar.una(l);
  }

  @Put('legalizaciones/:id/soportes/:soporteId/confirmacion')
  async confirmar(
    @UsuarioActual() u: string,
    @Param('id') id: string,
    @Param('soporteId') soporteId: string,
    @Body(new ZodValidationPipe(confirmarSoporteRequestSchema)) soporte: z.output<typeof confirmarSoporteRequestSchema>,
  ): Promise<LegalizacionResponse> {
    return this.presentar.una(await this.gestion.confirmarSoporte({ legalizacionId: id, soporteId, usuarioId: u, soporte }));
  }

  @Delete('legalizaciones/:id/soportes/:soporteId')
  async eliminar(@UsuarioActual() u: string, @Param('id') id: string, @Param('soporteId') soporteId: string): Promise<LegalizacionResponse> {
    return this.presentar.una(await this.gestion.eliminarSoporte({ legalizacionId: id, soporteId, usuarioId: u }));
  }

  @Get('legalizaciones/:id/soportes/:soporteId/archivo')
  async archivo(
    @UsuarioActual() u: string,
    @RolesUsuario() roles: string[],
    @Param('id') id: string,
    @Param('soporteId') soporteId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { contenido, mime, nombre } = await this.gestion.leerArchivo({ legalizacionId: id, soporteId, usuarioId: u, roles });
    res
      .status(200)
      .type(mime)
      .setHeader('X-Content-Type-Options', 'nosniff')
      .setHeader('Cache-Control', 'private, max-age=300')
      .setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`)
      .send(contenido);
  }

  @Post('legalizaciones/:id/enviar')
  @HttpCode(200)
  async enviar(@UsuarioActual() u: string, @Param('id') id: string): Promise<LegalizacionResponse> {
    return this.presentar.una(await this.gestion.enviar(id, u));
  }

  // ---------- Contabilidad ----------

  @Post('legalizaciones/:id/soportes/:soporteId/decision')
  @Roles('CONTABILIDAD')
  @HttpCode(200)
  async decidir(
    @UsuarioActual() u: string,
    @Param('id') id: string,
    @Param('soporteId') soporteId: string,
    @Body(new ZodValidationPipe(decisionSoporteRequestSchema)) body: { aplica: boolean; comentario?: string },
  ): Promise<LegalizacionResponse> {
    return this.presentar.una(await this.gestion.decidirSoporte({ legalizacionId: id, soporteId, contadorId: u, ...body }));
  }

  /** Contabilidad verifica una línea (palabra ambigua, propina sin valor sugerido) o corrige una exclusión. */
  @Post('legalizaciones/:id/soportes/:soporteId/lineas/:indice/decision')
  @Roles('CONTABILIDAD')
  @HttpCode(200)
  async decidirLinea(
    @UsuarioActual() u: string,
    @Param('id') id: string,
    @Param('soporteId') soporteId: string,
    @Param('indice', new ZodValidationPipe(z.coerce.number().int().min(0).max(59))) indice: number,
    @Body(new ZodValidationPipe(decisionLineaRequestSchema)) body: { excluir: boolean },
  ): Promise<LegalizacionResponse> {
    return this.presentar.una(await this.gestion.decidirLinea({ legalizacionId: id, soporteId, indice, excluir: body.excluir, contadorId: u }));
  }

  @Post('legalizaciones/:id/aprobar')
  @Roles('CONTABILIDAD')
  @HttpCode(200)
  async aprobar(@UsuarioActual() u: string, @Param('id') id: string): Promise<LegalizacionResponse> {
    return this.presentar.una(await this.gestion.aprobar(id, u));
  }

  @Post('legalizaciones/:id/devolver')
  @Roles('CONTABILIDAD')
  @HttpCode(200)
  async devolver(
    @UsuarioActual() u: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(devolverLegalizacionRequestSchema)) body: { comentario: string },
  ): Promise<LegalizacionResponse> {
    return this.presentar.una(await this.gestion.devolver(id, u, body.comentario));
  }

  /** Cualquier usuario la consulta (tope del recibo, exclusiones); solo contabilidad la cambia. */
  @Get('politica-legalizacion')
  async politica(): Promise<PoliticaLegalizacionResponse> {
    return presentarPolitica(await this.gestion.obtenerPolitica());
  }

  @Put('politica-legalizacion')
  @Roles('CONTABILIDAD')
  async actualizarPolitica(
    @UsuarioActual() u: string,
    @Body(new ZodValidationPipe(politicaLegalizacionSchema)) body: z.output<typeof politicaLegalizacionSchema>,
  ): Promise<PoliticaLegalizacionResponse> {
    return presentarPolitica(await this.gestion.actualizarPolitica({ contadorId: u, ...body }));
  }
}
