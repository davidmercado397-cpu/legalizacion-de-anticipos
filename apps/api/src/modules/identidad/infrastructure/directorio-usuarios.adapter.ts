import type { ConsultarUsuarioUseCase, Usuario } from '../../organizacion/application/consultar-usuario.use-case';
import type { DirectorioUsuarios, UsuarioIdentidad } from '../application/puertos';

const aIdentidad = (u: Usuario | null): UsuarioIdentidad | null =>
  u ? { id: u.id, nombre: u.nombre, email: u.email, roles: [...u.roles] } : null;

export class DirectorioUsuariosAdapter implements DirectorioUsuarios {
  constructor(private readonly consultar: ConsultarUsuarioUseCase) {}

  async porEmail(email: string): Promise<UsuarioIdentidad | null> {
    return aIdentidad(await this.consultar.porEmail(email));
  }

  async porId(id: string): Promise<UsuarioIdentidad | null> {
    return aIdentidad(await this.consultar.ejecutar(id));
  }
}
