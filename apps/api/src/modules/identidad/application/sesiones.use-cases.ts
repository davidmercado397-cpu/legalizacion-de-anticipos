import { DomainError } from '@viaticos/shared-kernel';
import type { GeneradorIds, Reloj } from '../../../shared/application/puertos';
import type { CredencialRepository, Sesion, SesionRepository } from '../domain/sesion';
import type {
  DirectorioUsuarios,
  EmisorTokensAcceso,
  HasherContrasenas,
  TokensOpacos,
  UsuarioIdentidad,
} from './puertos';

export interface SesionEmitida {
  accessToken: string;
  expiraEn: Date;
  refreshToken: string;
  refreshExpiraEn: Date;
  usuario: UsuarioIdentidad;
}

const MS_POR_DIA = 86_400_000;
const credencialesInvalidas = () =>
  new DomainError('CREDENCIALES_INVALIDAS', 'NO_AUTENTICADO', 'Correo o contraseña incorrectos');
const sesionInvalida = () =>
  new DomainError('SESION_INVALIDA', 'NO_AUTENTICADO', 'La sesión expiró; inicie sesión de nuevo');

/** Servicio de aplicación con los tres flujos de sesión. */
export class GestorSesiones {
  /** Hash ficticio para que un correo inexistente tarde lo mismo que una contraseña errada. */
  private hashFicticio: Promise<string> | null = null;

  constructor(
    private readonly directorio: DirectorioUsuarios,
    private readonly credenciales: CredencialRepository,
    private readonly sesiones: SesionRepository,
    private readonly hasher: HasherContrasenas,
    private readonly tokensAcceso: EmisorTokensAcceso,
    private readonly tokensOpacos: TokensOpacos,
    private readonly ids: GeneradorIds,
    private readonly reloj: Reloj,
    private readonly diasRefresh: number,
  ) {}

  async iniciar(email: string, contrasena: string): Promise<SesionEmitida> {
    const usuario = await this.directorio.porEmail(email);
    const hash = usuario ? await this.credenciales.obtenerHash(usuario.id) : null;
    if (!usuario || !hash) {
      this.hashFicticio ??= this.hasher.hash('contrasena-ficticia-para-tiempo-constante');
      await this.hasher.verificar(await this.hashFicticio, contrasena);
      throw credencialesInvalidas();
    }
    if (!(await this.hasher.verificar(hash, contrasena))) throw credencialesInvalidas();
    return this.emitir(usuario, this.ids.nuevo());
  }

  /**
   * Rotación: cada refresh token sirve una sola vez. Si llega uno ya usado,
   * se asume robo y se revoca toda la familia (todas las sesiones de ese login).
   */
  async refrescar(refreshToken: string): Promise<SesionEmitida> {
    const ahora = this.reloj.ahora();
    const sesion = await this.sesiones.obtenerPorHash(this.tokensOpacos.hash(refreshToken));
    if (!sesion) throw sesionInvalida();

    if (sesion.revocadaEn || !(await this.sesiones.revocarSiActiva(sesion.id, ahora))) {
      await this.sesiones.revocarFamilia(sesion.familiaId, ahora);
      throw new DomainError('SESION_REUTILIZADA', 'NO_AUTENTICADO', 'Por seguridad se cerraron sus sesiones');
    }
    if (sesion.expiraEn <= ahora) throw sesionInvalida();

    const usuario = await this.directorio.porId(sesion.usuarioId);
    if (!usuario) throw sesionInvalida();
    return this.emitir(usuario, sesion.familiaId);
  }

  async cerrar(refreshToken: string): Promise<void> {
    const sesion = await this.sesiones.obtenerPorHash(this.tokensOpacos.hash(refreshToken));
    if (sesion) await this.sesiones.revocarFamilia(sesion.familiaId, this.reloj.ahora());
  }

  async perfil(usuarioId: string): Promise<UsuarioIdentidad> {
    const usuario = await this.directorio.porId(usuarioId);
    if (!usuario) throw sesionInvalida();
    return usuario;
  }

  private async emitir(usuario: UsuarioIdentidad, familiaId: string): Promise<SesionEmitida> {
    const ahora = this.reloj.ahora();
    const refreshToken = this.tokensOpacos.generar();
    const sesion: Sesion = {
      id: this.ids.nuevo(),
      usuarioId: usuario.id,
      familiaId,
      hashToken: this.tokensOpacos.hash(refreshToken),
      expiraEn: new Date(ahora.getTime() + this.diasRefresh * MS_POR_DIA),
      revocadaEn: null,
    };
    await this.sesiones.crear(sesion);
    const acceso = await this.tokensAcceso.emitir({ usuarioId: usuario.id, roles: usuario.roles });
    return {
      accessToken: acceso.token,
      expiraEn: acceso.expiraEn,
      refreshToken,
      refreshExpiraEn: sesion.expiraEn,
      usuario,
    };
  }
}

/** Política mínima de contraseñas para cuentas locales. */
export class EstablecerContrasenaUseCase {
  constructor(
    private readonly credenciales: CredencialRepository,
    private readonly hasher: HasherContrasenas,
    private readonly directorio?: DirectorioUsuarios,
  ) {}

  async ejecutar(usuarioId: string, contrasena: string): Promise<void> {
    if (this.directorio && !(await this.directorio.porId(usuarioId))) {
      throw new DomainError('USUARIO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El usuario no existe o está inactivo');
    }
    if (contrasena.length < 10 || !/\d/.test(contrasena) || !/[A-Za-z]/.test(contrasena)) {
      throw new DomainError(
        'CONTRASENA_DEBIL',
        'VALIDACION',
        'La contraseña debe tener al menos 10 caracteres, con letras y números',
      );
    }
    await this.credenciales.guardar(usuarioId, await this.hasher.hash(contrasena));
  }
}
