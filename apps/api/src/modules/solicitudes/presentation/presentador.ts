import type { SolicitudResponse } from '@viaticos/contracts';
import type { DirectorioOrganizacional } from '../application/puertos';
import type { SolicitudViaje } from '../domain/solicitud-viaje';
import { personasDe, presentarSolicitud } from './solicitud.presenter';

/** Presenta solicitudes resolviendo los nombres de todas las personas con una sola consulta. */
export class PresentadorSolicitudes {
  constructor(private readonly directorio: DirectorioOrganizacional) {}

  async una(solicitud: SolicitudViaje): Promise<SolicitudResponse> {
    const [respuesta] = await this.varias([solicitud]);
    return respuesta!;
  }

  async varias(solicitudes: readonly SolicitudViaje[]): Promise<SolicitudResponse[]> {
    const nombres = await this.directorio.nombres(personasDe(solicitudes));
    return solicitudes.map((s) => presentarSolicitud(s, nombres));
  }
}
