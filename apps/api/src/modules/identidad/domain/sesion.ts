export interface Sesion {
  id: string;
  usuarioId: string;
  /** Todas las rotaciones de un mismo login comparten familia. */
  familiaId: string;
  hashToken: string;
  expiraEn: Date;
  revocadaEn: Date | null;
}

export interface SesionRepository {
  crear(sesion: Sesion): Promise<void>;
  obtenerPorHash(hashToken: string): Promise<Sesion | null>;
  /** Revoca de forma atómica. Devuelve false si ya estaba revocada (posible reutilización). */
  revocarSiActiva(id: string, ahora: Date): Promise<boolean>;
  revocarFamilia(familiaId: string, ahora: Date): Promise<void>;
}

export interface CredencialRepository {
  obtenerHash(usuarioId: string): Promise<string | null>;
  guardar(usuarioId: string, hashContrasena: string): Promise<void>;
}
