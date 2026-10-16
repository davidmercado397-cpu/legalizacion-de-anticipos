import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  cargarExtractoRequestSchema,
  enlazarMovimientoRequestSchema,
  vistaPreviaExtractoRequestSchema,
  type ExtractoResponse,
  type ExtractoResumenResponse,
  type PerfilGuardadoResponse,
  type VistaPreviaExtractoResponse,
} from '@viaticos/contracts';
import { DomainError } from '@viaticos/shared-kernel';
import { z } from 'zod';
import { Roles, RolesUsuario, UsuarioActual } from '../../../shared/presentation/autenticacion';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { GestionConciliacion, TAMANO_MAXIMO_EXTRACTO } from '../application/conciliacion.use-cases';
import { PresentadorExtractos, presentarMovimientoLeido } from './extracto.presenter';

const SUBIDA = FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO_EXTRACTO, files: 1, fields: 10 } });
const porLegalizacion = z.object({ legalizacionId: z.string().optional() });

const exigirArchivo = (archivo: Express.Multer.File | undefined) => {
  if (!archivo) throw new DomainError('ARCHIVO_REQUERIDO', 'VALIDACION', 'Adjunte el archivo del extracto (.csv, .txt o .xlsx)');
  // multer entrega el nombre en latin1; los nombres con tildes vienen en UTF-8.
  return { nombre: Buffer.from(archivo.originalname, 'latin1').toString('utf8'), contenido: archivo.buffer };
};

@Controller('conciliacion')
export class ConciliacionController {
  constructor(
    @Inject(GestionConciliacion) private readonly gestion: GestionConciliacion,
    @Inject(PresentadorExtractos) private readonly presentar: PresentadorExtractos,
  ) {}

  /** Lee el archivo sin guardarlo: muestra las filas y el mapeo sugerido (o el indicado). */
  @Post('extractos/vista-previa')
  @HttpCode(200)
  @UseInterceptors(SUBIDA)
  async vistaPrevia(
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(vistaPreviaExtractoRequestSchema)) campos: z.output<typeof vistaPreviaExtractoRequestSchema>,
  ): Promise<VistaPreviaExtractoResponse> {
    const r = await this.gestion.vistaPrevia(exigirArchivo(archivo), campos.perfil ?? null, campos.moneda);
    return {
      ...r,
      movimientos: r.movimientos.map(presentarMovimientoLeido),
      perfilesGuardados: r.perfilesGuardados.map((p) => ({ id: p.id, nombre: p.nombre, perfil: p.perfil })),
    };
  }

  @Post('extractos')
  @UseInterceptors(SUBIDA)
  async cargar(
    @UsuarioActual() usuarioId: string,
    @RolesUsuario() roles: string[],
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(cargarExtractoRequestSchema)) campos: z.output<typeof cargarExtractoRequestSchema>,
  ): Promise<ExtractoResponse> {
    return this.presentar.detalle(
      await this.gestion.cargar({
        archivo: exigirArchivo(archivo),
        legalizacionId: campos.legalizacionId,
        ultimos4: campos.ultimos4 ?? null,
        perfil: campos.perfil,
        guardarPerfilComo: campos.guardarPerfilComo ?? null,
        usuarioId,
        roles,
      }),
    );
  }

  /** Con `legalizacionId`: extractos del viajero de esa legalización. Sin él (contabilidad): los más recientes. */
  @Get('extractos')
  async listar(
    @UsuarioActual() usuarioId: string,
    @RolesUsuario() roles: string[],
    @Query(new ZodValidationPipe(porLegalizacion)) q: z.output<typeof porLegalizacion>,
  ): Promise<ExtractoResumenResponse[]> {
    if (q.legalizacionId) return this.presentar.varios(await this.gestion.listarDeLegalizacion(q.legalizacionId, usuarioId, roles));
    if (!roles.includes('CONTABILIDAD')) throw new DomainError('NO_AUTORIZADO', 'NO_AUTORIZADO', 'Solo contabilidad ve todos los extractos');
    return this.presentar.varios(await this.gestion.listarRecientes());
  }

  @Get('extractos/:id')
  async obtener(@UsuarioActual() usuarioId: string, @RolesUsuario() roles: string[], @Param('id') id: string): Promise<ExtractoResponse> {
    return this.presentar.detalle(await this.gestion.obtener(id, usuarioId, roles));
  }

  @Post('extractos/:id/recalcular')
  @HttpCode(200)
  @Roles('CONTABILIDAD')
  async recalcular(@Param('id') id: string): Promise<ExtractoResponse> {
    return this.presentar.detalle(await this.gestion.recalcular(id));
  }

  @Post('extractos/:id/movimientos/:movimientoId/confirmar')
  @HttpCode(200)
  @Roles('CONTABILIDAD')
  async confirmar(@UsuarioActual() u: string, @Param('id') id: string, @Param('movimientoId') movimientoId: string): Promise<ExtractoResponse> {
    return this.presentar.detalle(await this.gestion.confirmar(id, movimientoId, u));
  }

  @Post('extractos/:id/movimientos/:movimientoId/rechazar')
  @HttpCode(200)
  @Roles('CONTABILIDAD')
  async rechazar(@Param('id') id: string, @Param('movimientoId') movimientoId: string): Promise<ExtractoResponse> {
    return this.presentar.detalle(await this.gestion.rechazar(id, movimientoId));
  }

  @Post('extractos/:id/movimientos/:movimientoId/enlazar')
  @HttpCode(200)
  @Roles('CONTABILIDAD')
  async enlazar(
    @UsuarioActual() u: string,
    @Param('id') id: string,
    @Param('movimientoId') movimientoId: string,
    @Body(new ZodValidationPipe(enlazarMovimientoRequestSchema)) body: z.output<typeof enlazarMovimientoRequestSchema>,
  ): Promise<ExtractoResponse> {
    return this.presentar.detalle(await this.gestion.enlazar(id, movimientoId, body.soporteId, u));
  }

  @Get('perfiles')
  @Roles('CONTABILIDAD')
  async perfiles(): Promise<PerfilGuardadoResponse[]> {
    return (await this.gestion.listarPerfiles()).map((p) => ({ id: p.id, nombre: p.nombre, perfil: p.perfil }));
  }
}
