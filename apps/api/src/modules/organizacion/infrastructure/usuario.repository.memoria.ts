import { DomainError } from '@viaticos/shared-kernel';
import type { Cargo, CargoRepository, Empresa, EmpresaRepository } from '../domain/empresa';
import type { Rol, Usuario, UsuarioRepository } from '../domain/usuario';

export class UsuarioRepositoryEnMemoria implements UsuarioRepository {
  private readonly usuarios = new Map<string, Usuario>();

  constructor(iniciales: readonly Usuario[] = []) {
    iniciales.forEach((u) => this.usuarios.set(u.id, u));
  }

  async obtenerPorId(id: string): Promise<Usuario | null> {
    return this.usuarios.get(id) ?? null;
  }

  async obtenerVarios(ids: readonly string[]): Promise<Usuario[]> {
    return ids.flatMap((id) => this.usuarios.get(id) ?? []);
  }

  async listarActivosConRol(rol: Rol): Promise<Usuario[]> {
    return [...this.usuarios.values()].filter((u) => u.activo && u.roles.includes(rol)).sort((a, b) => a.id.localeCompare(b.id));
  }

  async listar(): Promise<Usuario[]> {
    return [...this.usuarios.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  async guardar(usuario: Usuario): Promise<void> {
    const otro = [...this.usuarios.values()].find((u) => u.email.toLowerCase() === usuario.email.toLowerCase() && u.id !== usuario.id);
    if (otro) throw new DomainError('EMAIL_REPETIDO', 'CONFLICTO', 'Ese correo ya lo usa otro usuario');
    this.usuarios.set(usuario.id, usuario);
  }

  async obtenerPorEmail(email: string): Promise<Usuario | null> {
    const buscado = email.toLowerCase();
    return [...this.usuarios.values()].find((u) => u.email.toLowerCase() === buscado) ?? null;
  }
}

/** Datos de desarrollo: viajero → jefe inmediato → jefe directivo → gerencia. */
export const USUARIOS_DESARROLLO: readonly Usuario[] = [
  {
    id: 'u-viajero',
    nombre: 'Ana Viajera',
    email: 'ana@empresa.co',
    cargoId: 'ANALISTA',
    empresaId: 'emp-principal',
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
    empresaId: 'emp-principal',
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
    empresaId: 'emp-principal',
    jefeInmediatoId: null,
    jefeDirectivoId: null,
    roles: ['VIAJERO', 'APROBADOR'],
    activo: true,
  },
  {
    id: 'u-tesoreria',
    nombre: 'Tomás Tesorero',
    email: 'tomas@empresa.co',
    cargoId: 'ANALISTA',
    empresaId: 'emp-principal',
    jefeInmediatoId: 'u-directivo',
    jefeDirectivoId: 'u-directivo',
    roles: ['TESORERIA'],
    activo: true,
  },
  {
    id: 'u-contabilidad',
    nombre: 'Laura Contable',
    email: 'laura@empresa.co',
    cargoId: 'ANALISTA',
    empresaId: 'emp-principal',
    jefeInmediatoId: 'u-directivo',
    jefeDirectivoId: 'u-directivo',
    roles: ['CONTABILIDAD'],
    activo: true,
  },
  {
    id: 'u-gerencia',
    nombre: 'Gabriela Gerente',
    email: 'gabriela@empresa.co',
    cargoId: 'DIRECTOR',
    empresaId: 'emp-principal',
    jefeInmediatoId: null,
    jefeDirectivoId: null,
    roles: ['VIAJERO', 'APROBADOR', 'GERENCIA'],
    activo: true,
  },
  {
    id: 'u-admin',
    nombre: 'Andrés Administrador',
    email: 'andres@empresa.co',
    cargoId: 'ANALISTA',
    empresaId: 'emp-principal',
    jefeInmediatoId: 'u-directivo',
    jefeDirectivoId: 'u-directivo',
    roles: ['ADMIN'],
    activo: true,
  },
];

export class EmpresaRepositoryEnMemoria implements EmpresaRepository {
  private readonly empresas: Map<string, Empresa>;

  constructor(iniciales: readonly Empresa[] = []) {
    this.empresas = new Map(iniciales.map((e) => [e.id, e]));
  }

  async listar(): Promise<Empresa[]> {
    return [...this.empresas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  async obtenerPorId(id: string): Promise<Empresa | null> {
    return this.empresas.get(id) ?? null;
  }

  async guardar(empresa: Empresa): Promise<void> {
    this.empresas.set(empresa.id, empresa);
  }
}

export class CargoRepositoryEnMemoria implements CargoRepository {
  private readonly cargos: Map<string, Cargo>;

  constructor(iniciales: readonly Cargo[] = []) {
    this.cargos = new Map(iniciales.map((c) => [c.codigo, c]));
  }

  async listar(): Promise<Cargo[]> {
    return [...this.cargos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  async guardar(cargo: Cargo): Promise<void> {
    this.cargos.set(cargo.codigo, cargo);
  }
}

/** Valores de ejemplo: el NIT real lo configura contabilidad. Es un holding con varias empresas. */
export const EMPRESAS_DESARROLLO: readonly Empresa[] = [
  { id: 'emp-principal', nombre: 'Empresa Colombia S.A.S.', nit: '900123456', activa: true },
  { id: 'emp-filial', nombre: 'Filial Logística S.A.S.', nit: '901765432', activa: true },
];

export const CARGOS_DESARROLLO: readonly Cargo[] = [
  { codigo: 'ANALISTA', nombre: 'Analista', activo: true },
  { codigo: 'COORDINADOR', nombre: 'Coordinador', activo: true },
  { codigo: 'DIRECTOR', nombre: 'Director', activo: true },
];
