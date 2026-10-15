import { eq, sql } from 'drizzle-orm';
import type { BaseDatos } from '../../../../shared/infrastructure/base-datos/conexion';
import { ROLES, type Rol, type Usuario, type UsuarioRepository } from '../../domain/usuario';
import { usuarios } from './organizacion.schema';

type Fila = typeof usuarios.$inferSelect;

const aDominio = (f: Fila): Usuario => ({
  id: f.id,
  nombre: f.nombre,
  email: f.email,
  cargoId: f.cargoId,
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

  async obtenerPorEmail(email: string): Promise<Usuario | null> {
    const [fila] = await this.db
      .select()
      .from(usuarios)
      .where(sql`lower(${usuarios.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return fila ? aDominio(fila) : null;
  }
}
