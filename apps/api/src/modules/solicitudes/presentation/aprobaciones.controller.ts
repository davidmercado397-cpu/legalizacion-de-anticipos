import { Controller, Get, Inject } from '@nestjs/common';
import type { SolicitudResponse } from '@viaticos/contracts';
import { UsuarioActual } from '../../../shared/presentation/autenticacion';
import { ConsultarSolicitudesUseCase } from '../application/consultar-solicitudes.use-case';
import { PresentadorSolicitudes } from './presentador';

@Controller('aprobaciones')
export class AprobacionesController {
  constructor(
    @Inject(ConsultarSolicitudesUseCase) private readonly consultar: ConsultarSolicitudesUseCase,
    @Inject(PresentadorSolicitudes) private readonly presentar: PresentadorSolicitudes,
  ) {}

  /** Bandeja del aprobador: solicitudes cuyo paso actual le corresponde. */
  @Get('pendientes')
  async pendientes(@UsuarioActual() usuarioId: string): Promise<SolicitudResponse[]> {
    return this.presentar.varias(await this.consultar.listarPendientesDeAprobar(usuarioId));
  }
}
