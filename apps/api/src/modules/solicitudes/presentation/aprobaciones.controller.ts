import { Controller, Get, Inject } from '@nestjs/common';
import type { SolicitudResponse } from '@viaticos/contracts';
import { UsuarioActual } from '../../../shared/presentation/autenticacion';
import { ConsultarSolicitudesUseCase } from '../application/consultar-solicitudes.use-case';
import { presentarSolicitud } from './solicitud.presenter';

@Controller('aprobaciones')
export class AprobacionesController {
  constructor(@Inject(ConsultarSolicitudesUseCase) private readonly consultar: ConsultarSolicitudesUseCase) {}

  /** Bandeja del aprobador: solicitudes cuyo paso actual le corresponde. */
  @Get('pendientes')
  async pendientes(@UsuarioActual() usuarioId: string): Promise<SolicitudResponse[]> {
    return (await this.consultar.listarPendientesDeAprobar(usuarioId)).map(presentarSolicitud);
  }
}
