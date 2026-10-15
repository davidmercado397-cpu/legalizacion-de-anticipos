import { Module } from '@nestjs/common';
import { ConsultarUsuarioUseCase } from './application/consultar-usuario.use-case';
import type { UsuarioRepository } from './domain/usuario';
import { USUARIOS_DESARROLLO, UsuarioRepositoryEnMemoria } from './infrastructure/usuario.repository.memoria';
import { USUARIO_REPOSITORY } from './organizacion.tokens';

@Module({
  providers: [
    { provide: USUARIO_REPOSITORY, useFactory: () => new UsuarioRepositoryEnMemoria(USUARIOS_DESARROLLO) },
    {
      provide: ConsultarUsuarioUseCase,
      useFactory: (repo: UsuarioRepository) => new ConsultarUsuarioUseCase(repo),
      inject: [USUARIO_REPOSITORY],
    },
  ],
  exports: [ConsultarUsuarioUseCase],
})
export class OrganizacionModule {}
