import type { Usuario, UsuarioRepository } from '../domain/usuario';

/** API pública del módulo para que otros módulos consulten usuarios activos. */
export class ConsultarUsuarioUseCase {
  constructor(private readonly usuarios: UsuarioRepository) {}

  async ejecutar(usuarioId: string): Promise<Usuario | null> {
    const usuario = await this.usuarios.obtenerPorId(usuarioId);
    return usuario?.activo ? usuario : null;
  }
}
