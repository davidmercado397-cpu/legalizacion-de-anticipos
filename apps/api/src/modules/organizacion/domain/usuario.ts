export const ROLES = ['VIAJERO', 'APROBADOR', 'GERENCIA', 'TESORERIA', 'CONTABILIDAD', 'ADMIN'] as const;
export type Rol = (typeof ROLES)[number];

export interface Usuario {
  readonly id: string;
  readonly nombre: string;
  readonly email: string;
  readonly cargoId: string;
  /** Empresa del holding a la que pertenece (define el NIT de sus facturas). */
  readonly empresaId: string;
  readonly jefeInmediatoId: string | null;
  readonly jefeDirectivoId: string | null;
  readonly roles: readonly Rol[];
  readonly activo: boolean;
}

export interface UsuarioRepository {
  obtenerPorId(id: string): Promise<Usuario | null>;
  /** Búsqueda sin distinguir mayúsculas. */
  obtenerPorEmail(email: string): Promise<Usuario | null>;
  obtenerVarios(ids: readonly string[]): Promise<Usuario[]>;
  /** Usuarios activos con un rol, ordenados por id. */
  listarActivosConRol(rol: Rol): Promise<Usuario[]>;
  listar(): Promise<Usuario[]>;
  /** Inserta o actualiza. Lanza CONFLICTO si el correo ya lo usa otro usuario. */
  guardar(usuario: Usuario): Promise<void>;
}
