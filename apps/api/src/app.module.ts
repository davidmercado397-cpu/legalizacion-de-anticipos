import { Module, type DynamicModule } from '@nestjs/common';
import { ComprobantesModule } from './modules/comprobantes/comprobantes.module';
import { IdentidadModule } from './modules/identidad/identidad.module';
import { TarifasModule } from './modules/tarifas/tarifas.module';
import { SolicitudesModule } from './modules/solicitudes/solicitudes.module';
import { SaludController } from './salud.controller';
import type { Configuracion } from './shared/configuracion';
import { SharedModule } from './shared/shared.module';

@Module({})
export class AppModule {
  static forRoot(configuracion: Configuracion): DynamicModule {
    return {
      module: AppModule,
      imports: [SharedModule.forRoot(configuracion), IdentidadModule, TarifasModule, SolicitudesModule, ComprobantesModule],
      controllers: [SaludController],
    };
  }
}
