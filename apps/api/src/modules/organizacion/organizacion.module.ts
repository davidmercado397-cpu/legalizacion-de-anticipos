import { Module } from '@nestjs/common';
import { segunPersistencia } from '../../shared/infrastructure/base-datos/segun-persistencia';
import { ConsultarUsuarioUseCase } from './application/consultar-usuario.use-case';
import type { UsuarioRepository } from './domain/usuario';
import { UsuarioRepositoryDrizzle } from './infrastructure/persistencia/usuario.repository.drizzle';
import { USUARIOS_DESARROLLO, UsuarioRepositoryEnMemoria } from './infrastructure/usuario.repository.memoria';
import { USUARIO_REPOSITORY } from './organizacion.tokens';

@Module({
  providers: [
    segunPersistencia<UsuarioRepository>(USUARIO_REPOSITORY, {
      memoria: () => new UsuarioRepositoryEnMemoria(USUARIOS_DESARROLLO),
      postgres: (db) => new UsuarioRepositoryDrizzle(db),
    }),
    {
      provide: ConsultarUsuarioUseCase,
      useFactory: (repo: UsuarioRepository) => new ConsultarUsuarioUseCase(repo),
      inject: [USUARIO_REPOSITORY],
    },
  ],
  exports: [ConsultarUsuarioUseCase],
})
export class OrganizacionModule {}
