import type { Usuario, UsuarioRepository } from '../domain/usuario';

/** Vista pública del usuario para otros módulos. */
export type { Usuario };

/** API pública del módulo para que otros módulos consulten usuarios activos. */
export class ConsultarUsuarioUseCase {
  constructor(private readonly usuarios: UsuarioRepository) {}

  async ejecutar(usuarioId: string): Promise<Usuario | null> {
    const usuario = await this.usuarios.obtenerPorId(usuarioId);
    return usuario?.activo ? usuario : null;
  }

  async porEmail(email: string): Promise<Usuario | null> {
    const usuario = await this.usuarios.obtenerPorEmail(email.trim());
    return usuario?.activo ? usuario : null;
  }
}
