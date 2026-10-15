import { randomBytes } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type { GeneradorIds, Reloj } from '../../shared/application/puertos';
import type { Configuracion } from '../../shared/configuracion';
import { segunPersistencia } from '../../shared/infrastructure/base-datos/segun-persistencia';
import { CONFIGURACION, GENERADOR_IDS, RELOJ } from '../../shared/tokens';
import { ConsultarUsuarioUseCase } from '../organizacion/application/consultar-usuario.use-case';
import { OrganizacionModule } from '../organizacion/organizacion.module';
import type { EmisorTokensAcceso, HasherContrasenas } from './application/puertos';
import { EstablecerContrasenaUseCase, GestorSesiones } from './application/sesiones.use-cases';
import type { CredencialRepository, SesionRepository } from './domain/sesion';
import {
  CREDENCIAL_REPOSITORY,
  EMISOR_TOKENS_ACCESO,
  HASHER_CONTRASENAS,
  SESION_REPOSITORY,
} from './identidad.tokens';
import { EmisorTokensJose, HasherArgon2, TokensOpacosCrypto } from './infrastructure/criptografia';
import { DirectorioUsuariosAdapter } from './infrastructure/directorio-usuarios.adapter';
import {
  CredencialRepositoryDrizzle,
  SesionRepositoryDrizzle,
} from './infrastructure/persistencia/identidad.repository.drizzle';
import { CredencialRepositoryEnMemoria, SesionRepositoryEnMemoria } from './infrastructure/repositorios.memoria';
import { AuthController } from './presentation/auth.controller';
import { AutenticacionGuard } from './presentation/autenticacion.guard';

@Module({
  imports: [OrganizacionModule],
  controllers: [AuthController],
  providers: [
    segunPersistencia<SesionRepository>(SESION_REPOSITORY, {
      memoria: () => new SesionRepositoryEnMemoria(),
      postgres: (db) => new SesionRepositoryDrizzle(db),
    }),
    segunPersistencia<CredencialRepository>(CREDENCIAL_REPOSITORY, {
      memoria: () => new CredencialRepositoryEnMemoria(),
      postgres: (db) => new CredencialRepositoryDrizzle(db),
    }),
    { provide: HASHER_CONTRASENAS, useFactory: () => new HasherArgon2() },
    {
      provide: EMISOR_TOKENS_ACCESO,
      // En modo dev (nunca en producción) se usa un secreto aleatorio efímero si no se configuró uno.
      useFactory: (c: Configuracion) =>
        new EmisorTokensJose(c.JWT_SECRET ?? randomBytes(32).toString('hex'), c.JWT_ACCESS_TTL_SEGUNDOS),
      inject: [CONFIGURACION],
    },
    {
      provide: GestorSesiones,
      useFactory: (
        consultar: ConsultarUsuarioUseCase,
        credenciales: CredencialRepository,
        sesiones: SesionRepository,
        hasher: HasherContrasenas,
        tokens: EmisorTokensAcceso,
        ids: GeneradorIds,
        reloj: Reloj,
        c: Configuracion,
      ) =>
        new GestorSesiones(
          new DirectorioUsuariosAdapter(consultar),
          credenciales,
          sesiones,
          hasher,
          tokens,
          new TokensOpacosCrypto(),
          ids,
          reloj,
          c.REFRESH_TTL_DIAS,
        ),
      inject: [
        ConsultarUsuarioUseCase,
        CREDENCIAL_REPOSITORY,
        SESION_REPOSITORY,
        HASHER_CONTRASENAS,
        EMISOR_TOKENS_ACCESO,
        GENERADOR_IDS,
        RELOJ,
        CONFIGURACION,
      ],
    },
    {
      provide: EstablecerContrasenaUseCase,
      useFactory: (credenciales: CredencialRepository, hasher: HasherContrasenas) =>
        new EstablecerContrasenaUseCase(credenciales, hasher),
      inject: [CREDENCIAL_REPOSITORY, HASHER_CONTRASENAS],
    },
    {
      provide: APP_GUARD,
      useFactory: (c: Configuracion, reflector: Reflector, tokens: EmisorTokensAcceso, consultar: ConsultarUsuarioUseCase) =>
        new AutenticacionGuard(c.AUTH_MODE, reflector, tokens, async (id) => [...((await consultar.ejecutar(id))?.roles ?? [])]),
      inject: [CONFIGURACION, Reflector, EMISOR_TOKENS_ACCESO, ConsultarUsuarioUseCase],
    },
  ],
  exports: [EstablecerContrasenaUseCase],
})
export class IdentidadModule {}
