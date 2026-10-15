import type { Usuario, UsuarioRepository } from '../domain/usuario';

export class UsuarioRepositoryEnMemoria implements UsuarioRepository {
  private readonly usuarios = new Map<string, Usuario>();

  constructor(iniciales: readonly Usuario[] = []) {
    iniciales.forEach((u) => this.usuarios.set(u.id, u));
  }

  async obtenerPorId(id: string): Promise<Usuario | null> {
    return this.usuarios.get(id) ?? null;
  }

  async obtenerPorEmail(email: string): Promise<Usuario | null> {
    const buscado = email.toLowerCase();
    return [...this.usuarios.values()].find((u) => u.email.toLowerCase() === buscado) ?? null;
  }
}

/** Datos de desarrollo: viajero → jefe inmediato → jefe directivo. */
export const USUARIOS_DESARROLLO: readonly Usuario[] = [
  {
    id: 'u-viajero',
    nombre: 'Ana Viajera',
    email: 'ana@empresa.co',
    cargoId: 'ANALISTA',
    jefeInmediatoId: 'u-jefe',
    jefeDirectivoId: 'u-directivo',
    roles: ['VIAJERO'],
    activo: true,
  },
  {
    id: 'u-jefe',
    nombre: 'Carlos Jefe',
    email: 'carlos@empresa.co',
    cargoId: 'COORDINADOR',
    jefeInmediatoId: 'u-directivo',
    jefeDirectivoId: 'u-directivo',
    roles: ['VIAJERO', 'APROBADOR'],
    activo: true,
  },
  {
    id: 'u-directivo',
    nombre: 'Diana Directiva',
    email: 'diana@empresa.co',
    cargoId: 'DIRECTOR',
    jefeInmediatoId: null,
    jefeDirectivoId: null,
    roles: ['VIAJERO', 'APROBADOR'],
    activo: true,
  },
  {
    id: 'u-contabilidad',
    nombre: 'Laura Contable',
    email: 'laura@empresa.co',
    cargoId: 'ANALISTA',
    jefeInmediatoId: 'u-directivo',
    jefeDirectivoId: 'u-directivo',
    roles: ['CONTABILIDAD'],
    activo: true,
  },
];
