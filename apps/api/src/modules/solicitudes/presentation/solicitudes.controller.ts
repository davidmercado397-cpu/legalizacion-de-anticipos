import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  aprobarSolicitudRequestSchema,
  crearSolicitudRequestSchema,
  estimarViajeRequestSchema,
  rechazarSolicitudRequestSchema,
  type CrearSolicitudCommand,
  type EstimadoResponse,
  type EstimarViajeCommand,
  type SolicitudResponse,
} from '@viaticos/contracts';
import { UsuarioActual } from '../../../shared/presentation/autenticacion';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { ConsultarSolicitudesUseCase } from '../application/consultar-solicitudes.use-case';
import { CrearSolicitudUseCase } from '../application/crear-solicitud.use-case';
import {
  AprobarSolicitudUseCase,
  CancelarSolicitudUseCase,
  RechazarSolicitudUseCase,
} from '../application/decidir-solicitud.use-cases';
import { EstimarViajeUseCase } from '../application/estimar-viaje.use-case';
import { presentarEstimado, presentarSolicitud } from './solicitud.presenter';

@Controller('solicitudes')
export class SolicitudesController {
  constructor(
    @Inject(EstimarViajeUseCase) private readonly estimarViaje: EstimarViajeUseCase,
    @Inject(CrearSolicitudUseCase) private readonly crearSolicitud: CrearSolicitudUseCase,
    @Inject(ConsultarSolicitudesUseCase) private readonly consultar: ConsultarSolicitudesUseCase,
    @Inject(AprobarSolicitudUseCase) private readonly aprobarSolicitud: AprobarSolicitudUseCase,
    @Inject(RechazarSolicitudUseCase) private readonly rechazarSolicitud: RechazarSolicitudUseCase,
    @Inject(CancelarSolicitudUseCase) private readonly cancelarSolicitud: CancelarSolicitudUseCase,
  ) {}

  @Post('estimar')
  @HttpCode(200)
  async estimar(
    @UsuarioActual() usuarioId: string,
    @Body(new ZodValidationPipe(estimarViajeRequestSchema)) body: EstimarViajeCommand,
  ): Promise<EstimadoResponse> {
    return presentarEstimado(await this.estimarViaje.ejecutar({ ...body, viajeroId: usuarioId }));
  }

  @Post()
  async crear(
    @UsuarioActual() usuarioId: string,
    @Body(new ZodValidationPipe(crearSolicitudRequestSchema)) body: CrearSolicitudCommand,
  ): Promise<SolicitudResponse> {
    return presentarSolicitud(await this.crearSolicitud.ejecutar({ ...body, viajeroId: usuarioId }));
  }

  @Get()
  async misSolicitudes(@UsuarioActual() usuarioId: string): Promise<SolicitudResponse[]> {
    return (await this.consultar.listarDelViajero(usuarioId)).map(presentarSolicitud);
  }

  @Get(':id')
  async obtener(@UsuarioActual() usuarioId: string, @Param('id') id: string): Promise<SolicitudResponse> {
    return presentarSolicitud(await this.consultar.obtener(id, usuarioId));
  }

  @Post(':id/aprobar')
  @HttpCode(200)
  async aprobar(
    @UsuarioActual() usuarioId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(aprobarSolicitudRequestSchema)) body: { comentario?: string },
  ): Promise<SolicitudResponse> {
    const s = await this.aprobarSolicitud.ejecutar({ solicitudId: id, aprobadorId: usuarioId, comentario: body.comentario });
    return presentarSolicitud(s);
  }

  @Post(':id/rechazar')
  @HttpCode(200)
  async rechazar(
    @UsuarioActual() usuarioId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rechazarSolicitudRequestSchema)) body: { comentario: string },
  ): Promise<SolicitudResponse> {
    const s = await this.rechazarSolicitud.ejecutar({ solicitudId: id, aprobadorId: usuarioId, comentario: body.comentario });
    return presentarSolicitud(s);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  async cancelar(@UsuarioActual() usuarioId: string, @Param('id') id: string): Promise<SolicitudResponse> {
    return presentarSolicitud(await this.cancelarSolicitud.ejecutar({ solicitudId: id, usuarioId }));
  }
}
