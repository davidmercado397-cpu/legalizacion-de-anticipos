import { and, arrayContains, asc, eq, inArray, sql } from 'drizzle-orm';
import { DomainError } from '@viaticos/shared-kernel';
import { VIOLACION_UNICIDAD, codigoErrorPg, type BaseDatos } from '../../../../shared/infrastructure/base-datos/conexion';
import type { Cargo, CargoRepository, Empresa, EmpresaRepository } from '../../domain/empresa';
import { ROLES, type Rol, type Usuario, type UsuarioRepository } from '../../domain/usuario';
import { cargos, empresas, usuarios } from './organizacion.schema';

type Fila = typeof usuarios.$inferSelect;

const aDominio = (f: Fila): Usuario => ({
  id: f.id,
  nombre: f.nombre,
  email: f.email,
  cargoId: f.cargoId,
  empresaId: f.empresaId,
  jefeInmediatoId: f.jefeInmediatoId,
  jefeDirectivoId: f.jefeDirectivoId,
  roles: f.roles.filter((r): r is Rol => (ROLES as readonly string[]).includes(r)),
  activo: f.activo,
});

export class UsuarioRepositoryDrizzle implements UsuarioRepository {
  constructor(private readonly db: BaseDatos) {}

  async obtenerPorId(id: string): Promise<Usuario | null> {
    const [fila] = await this.db.select().from(usuarios).where(eq(usuarios.id, id)).limit(1);
    return fila ? aDominio(fila) : null;
  }

  async obtenerVarios(ids: readonly string[]): Promise<Usuario[]> {
    if (ids.length === 0) return [];
    return (await this.db.select().from(usuarios).where(inArray(usuarios.id, [...ids]))).map(aDominio);
  }

  async listarActivosConRol(rol: Rol): Promise<Usuario[]> {
    const filas = await this.db
      .select()
      .from(usuarios)
      .where(and(eq(usuarios.activo, true), arrayContains(usuarios.roles, [rol])))
      .orderBy(asc(usuarios.id));
    return filas.map(aDominio);
  }

  async listar(): Promise<Usuario[]> {
    return (await this.db.select().from(usuarios).orderBy(asc(usuarios.nombre))).map(aDominio);
  }

  async guardar(u: Usuario): Promise<void> {
    const fila = {
      nombre: u.nombre,
      email: u.email,
      cargoId: u.cargoId,
      empresaId: u.empresaId,
      jefeInmediatoId: u.jefeInmediatoId,
      jefeDirectivoId: u.jefeDirectivoId,
      roles: [...u.roles],
      activo: u.activo,
    };
    try {
      await this.db.insert(usuarios).values({ id: u.id, ...fila }).onConflictDoUpdate({ target: usuarios.id, set: fila });
    } catch (error) {
      if (codigoErrorPg(error) === VIOLACION_UNICIDAD) throw new DomainError('EMAIL_REPETIDO', 'CONFLICTO', 'Ese correo ya lo usa otro usuario');
      throw error;
    }
  }

  async obtenerPorEmail(email: string): Promise<Usuario | null> {
    const [fila] = await this.db
      .select()
      .from(usuarios)
      .where(sql`lower(${usuarios.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return fila ? aDominio(fila) : null;
  }
}

export class EmpresaRepositoryDrizzle implements EmpresaRepository {
  constructor(private readonly db: BaseDatos) {}

  async listar(): Promise<Empresa[]> {
    return this.db.select().from(empresas).orderBy(asc(empresas.nombre));
  }

  async obtenerPorId(id: string): Promise<Empresa | null> {
    const [fila] = await this.db.select().from(empresas).where(eq(empresas.id, id)).limit(1);
    return fila ?? null;
  }

  async guardar(e: Empresa): Promise<void> {
    const fila = { nombre: e.nombre, nit: e.nit, activa: e.activa };
    try {
      await this.db.insert(empresas).values({ id: e.id, ...fila }).onConflictDoUpdate({ target: empresas.id, set: fila });
    } catch (error) {
      if (codigoErrorPg(error) === VIOLACION_UNICIDAD) throw new DomainError('NIT_REPETIDO', 'CONFLICTO', 'El NIT ya está registrado');
      throw error;
    }
  }
}

export class CargoRepositoryDrizzle implements CargoRepository {
  constructor(private readonly db: BaseDatos) {}

  async listar(): Promise<Cargo[]> {
    return this.db.select().from(cargos).orderBy(asc(cargos.nombre));
  }

  async guardar(c: Cargo): Promise<void> {
    const fila = { nombre: c.nombre, activo: c.activo };
    await this.db.insert(cargos).values({ codigo: c.codigo, ...fila }).onConflictDoUpdate({ target: cargos.codigo, set: fila });
  }
}
