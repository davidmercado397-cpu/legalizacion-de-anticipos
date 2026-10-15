import type { CredencialRepository, Sesion, SesionRepository } from '../domain/sesion';

export class SesionRepositoryEnMemoria implements SesionRepository {
  private readonly sesiones = new Map<string, Sesion>();

  async crear(sesion: Sesion): Promise<void> {
    this.sesiones.set(sesion.id, { ...sesion });
  }

  async obtenerPorHash(hashToken: string): Promise<Sesion | null> {
    const s = [...this.sesiones.values()].find((x) => x.hashToken === hashToken);
    return s ? { ...s } : null;
  }

  async revocarSiActiva(id: string, ahora: Date): Promise<boolean> {
    const s = this.sesiones.get(id);
    if (!s || s.revocadaEn) return false;
    s.revocadaEn = ahora;
    return true;
  }

  async revocarFamilia(familiaId: string, ahora: Date): Promise<void> {
    for (const s of this.sesiones.values()) if (s.familiaId === familiaId && !s.revocadaEn) s.revocadaEn = ahora;
  }
}

export class CredencialRepositoryEnMemoria implements CredencialRepository {
  private readonly hashes = new Map<string, string>();

  async obtenerHash(usuarioId: string): Promise<string | null> {
    return this.hashes.get(usuarioId) ?? null;
  }

  async guardar(usuarioId: string, hash: string): Promise<void> {
    this.hashes.set(usuarioId, hash);
  }
}
