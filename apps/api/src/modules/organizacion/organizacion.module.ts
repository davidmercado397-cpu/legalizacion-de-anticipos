import { Module } from '@nestjs/common';
import type { GeneradorIds } from '../../shared/application/puertos';
import { segunPersistencia } from '../../shared/infrastructure/base-datos/segun-persistencia';
import { GENERADOR_IDS } from '../../shared/tokens';
import { AdministrarOrganizacionUseCase } from './application/administrar-organizacion.use-case';
import { ConsultarUsuarioUseCase } from './application/consultar-usuario.use-case';
import type { CargoRepository, EmpresaRepository } from './domain/empresa';
import type { UsuarioRepository } from './domain/usuario';
import {
  CargoRepositoryDrizzle,
  EmpresaRepositoryDrizzle,
  UsuarioRepositoryDrizzle,
} from './infrastructure/persistencia/usuario.repository.drizzle';
import {
  CARGOS_DESARROLLO,
  CargoRepositoryEnMemoria,
  EMPRESAS_DESARROLLO,
  EmpresaRepositoryEnMemoria,
  USUARIOS_DESARROLLO,
  UsuarioRepositoryEnMemoria,
} from './infrastructure/usuario.repository.memoria';
import { CARGO_REPOSITORY, EMPRESA_REPOSITORY, USUARIO_REPOSITORY } from './organizacion.tokens';
import { AdministracionController } from './presentation/administracion.controller';

@Module({
  controllers: [AdministracionController],
  providers: [
    segunPersistencia<UsuarioRepository>(USUARIO_REPOSITORY, {
      memoria: () => new UsuarioRepositoryEnMemoria(USUARIOS_DESARROLLO),
      postgres: (db) => new UsuarioRepositoryDrizzle(db),
    }),
    segunPersistencia<EmpresaRepository>(EMPRESA_REPOSITORY, {
      memoria: () => new EmpresaRepositoryEnMemoria(EMPRESAS_DESARROLLO),
      postgres: (db) => new EmpresaRepositoryDrizzle(db),
    }),
    segunPersistencia<CargoRepository>(CARGO_REPOSITORY, {
      memoria: () => new CargoRepositoryEnMemoria(CARGOS_DESARROLLO),
      postgres: (db) => new CargoRepositoryDrizzle(db),
    }),
    {
      provide: ConsultarUsuarioUseCase,
      useFactory: (repo: UsuarioRepository, empresas: EmpresaRepository) => new ConsultarUsuarioUseCase(repo, empresas),
      inject: [USUARIO_REPOSITORY, EMPRESA_REPOSITORY],
    },
    {
      provide: AdministrarOrganizacionUseCase,
      useFactory: (usuarios: UsuarioRepository, empresas: EmpresaRepository, cargos: CargoRepository, ids: GeneradorIds) =>
        new AdministrarOrganizacionUseCase(usuarios, empresas, cargos, ids),
      inject: [USUARIO_REPOSITORY, EMPRESA_REPOSITORY, CARGO_REPOSITORY, GENERADOR_IDS],
    },
  ],
  exports: [ConsultarUsuarioUseCase],
})
export class OrganizacionModule {}
