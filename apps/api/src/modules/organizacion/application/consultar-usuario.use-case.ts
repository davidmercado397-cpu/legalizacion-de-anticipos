import type { Empresa, EmpresaRepository } from '../domain/empresa';
import type { Rol, Usuario, UsuarioRepository } from '../domain/usuario';

/** Vista pública del usuario para otros módulos. */
export type { Usuario };

/** API pública del módulo para que otros módulos consulten usuarios activos. */
export class ConsultarUsuarioUseCase {
  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly empresas?: EmpresaRepository,
  ) {}

  /** Empresa del usuario (para validar que sus facturas vengan a ese NIT). */
  async empresaDe(usuarioId: string): Promise<Empresa | null> {
    const usuario = await this.usuarios.obtenerPorId(usuarioId);
    return usuario && this.empresas ? this.empresas.obtenerPorId(usuario.empresaId) : null;
  }

  async ejecutar(usuarioId: string): Promise<Usuario | null> {
    const usuario = await this.usuarios.obtenerPorId(usuarioId);
    return usuario?.activo ? usuario : null;
  }

  /** Para mostrar nombres en listados (incluye inactivos: el historial debe seguir legible). */
  varios(ids: readonly string[]): Promise<Usuario[]> {
    return ids.length ? this.usuarios.obtenerVarios([...new Set(ids)]) : Promise.resolve([]);
  }

  /** Usuarios activos con un rol (por ejemplo, GERENCIA para aprobar viajes de directivos). */
  conRol(rol: Rol): Promise<Usuario[]> {
    return this.usuarios.listarActivosConRol(rol);
  }

  async porEmail(email: string): Promise<Usuario | null> {
    const usuario = await this.usuarios.obtenerPorEmail(email.trim());
    return usuario?.activo ? usuario : null;
  }
}
