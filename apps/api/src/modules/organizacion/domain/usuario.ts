export const ROLES = ['VIAJERO', 'APROBADOR', 'TESORERIA', 'CONTABILIDAD', 'ADMIN'] as const;
export type Rol = (typeof ROLES)[number];

export interface Usuario {
  readonly id: string;
  readonly nombre: string;
  readonly email: string;
  readonly cargoId: string;
  readonly jefeInmediatoId: string | null;
  readonly jefeDirectivoId: string | null;
  readonly roles: readonly Rol[];
  readonly activo: boolean;
}

export interface UsuarioRepository {
  obtenerPorId(id: string): Promise<Usuario | null>;
  /** Búsqueda sin distinguir mayúsculas. */
  obtenerPorEmail(email: string): Promise<Usuario | null>;
}
