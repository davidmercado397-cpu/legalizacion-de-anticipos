import { DomainError } from '@viaticos/shared-kernel';
import type { GeneradorIds } from '../../../shared/application/puertos';
import { crearCargo, crearEmpresa, type Cargo, type CargoRepository, type Empresa, type EmpresaRepository } from '../domain/empresa';
import { ROLES, type Rol, type Usuario, type UsuarioRepository } from '../domain/usuario';

export type { Cargo, Empresa };

export interface DatosUsuario {
  nombre: string;
  email: string;
  cargoId: string;
  empresaId: string;
  jefeInmediatoId: string | null;
  jefeDirectivoId: string | null;
  roles: Rol[];
  activo: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Administración de la estructura: empresas del holding (con su NIT), cargos y
 * usuarios con sus jefes y roles. La contraseña la asigna el módulo de identidad.
 */
export class AdministrarOrganizacionUseCase {
  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly empresas: EmpresaRepository,
    private readonly cargos: CargoRepository,
    private readonly ids: GeneradorIds,
  ) {}

  // ---------- Empresas ----------

  listarEmpresas(): Promise<Empresa[]> {
    return this.empresas.listar();
  }

  async guardarEmpresa(id: string | null, datos: { nombre: string; nit: string; activa: boolean }): Promise<Empresa> {
    if (id && !(await this.empresas.obtenerPorId(id))) throw new DomainError('EMPRESA_NO_ENCONTRADA', 'NO_ENCONTRADO', 'La empresa no existe');
    const empresa = crearEmpresa({ id: id ?? this.ids.nuevo(), ...datos });
    const otra = (await this.empresas.listar()).find((e) => e.nit === empresa.nit && e.id !== empresa.id);
    if (otra) throw new DomainError('NIT_REPETIDO', 'CONFLICTO', `El NIT ya está registrado para ${otra.nombre}`);
    if (!empresa.activa && (await this.usuarios.listar()).some((u) => u.activo && u.empresaId === empresa.id)) {
      throw new DomainError('EMPRESA_CON_USUARIOS', 'REGLA_NEGOCIO', 'Hay usuarios activos en esta empresa; muévalos antes de desactivarla');
    }
    await this.empresas.guardar(empresa);
    return empresa;
  }

  // ---------- Cargos ----------

  listarCargos(): Promise<Cargo[]> {
    return this.cargos.listar();
  }

  async guardarCargo(datos: Cargo): Promise<Cargo> {
    const cargo = crearCargo(datos);
    await this.cargos.guardar(cargo);
    return cargo;
  }

  // ---------- Usuarios ----------

  listarUsuarios(): Promise<Usuario[]> {
    return this.usuarios.listar();
  }

  async guardarUsuario(id: string | null, datos: DatosUsuario, administradorId: string): Promise<Usuario> {
    const actual = id ? await this.usuarios.obtenerPorId(id) : null;
    if (id && !actual) throw new DomainError('USUARIO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El usuario no existe');
    const usuarioId = id ?? this.ids.nuevo();

    const email = datos.email.trim().toLowerCase();
    if (!EMAIL.test(email)) throw new DomainError('EMAIL_INVALIDO', 'VALIDACION', 'Correo inválido');
    if (datos.nombre.trim().length < 3) throw new DomainError('NOMBRE_REQUERIDO', 'VALIDACION', 'Escriba el nombre completo');
    const roles = [...new Set(datos.roles)];
    if (roles.length === 0 || roles.some((r) => !(ROLES as readonly string[]).includes(r))) {
      throw new DomainError('ROLES_INVALIDOS', 'VALIDACION', 'Asigne al menos un rol válido');
    }

    const empresa = await this.empresas.obtenerPorId(datos.empresaId);
    if (!empresa?.activa) throw new DomainError('EMPRESA_NO_ENCONTRADA', 'VALIDACION', 'Elija una empresa activa');
    if (!(await this.cargos.listar()).some((c) => c.codigo === datos.cargoId && c.activo)) {
      throw new DomainError('CARGO_NO_ENCONTRADO', 'VALIDACION', 'Elija un cargo activo');
    }
    for (const jefeId of [datos.jefeInmediatoId, datos.jefeDirectivoId]) {
      if (!jefeId) continue;
      if (jefeId === usuarioId) throw new DomainError('AUTOJEFE', 'VALIDACION', 'Una persona no puede ser su propio jefe');
      const jefe = await this.usuarios.obtenerPorId(jefeId);
      if (!jefe?.activo) throw new DomainError('JEFE_NO_ENCONTRADO', 'VALIDACION', 'El jefe elegido no existe o está inactivo');
    }

    // El administrador no puede dejarse sin acceso a sí mismo.
    if (usuarioId === administradorId && (!datos.activo || !roles.includes('ADMIN'))) {
      throw new DomainError('AUTOBLOQUEO', 'REGLA_NEGOCIO', 'No puede quitarse a sí mismo el rol de administrador ni desactivarse');
    }

    const usuario: Usuario = {
      id: usuarioId,
      nombre: datos.nombre.trim(),
      email,
      cargoId: datos.cargoId,
      empresaId: empresa.id,
      jefeInmediatoId: datos.jefeInmediatoId,
      jefeDirectivoId: datos.jefeDirectivoId,
      roles,
      activo: datos.activo,
    };
    await this.usuarios.guardar(usuario);
    return usuario;
  }
}
