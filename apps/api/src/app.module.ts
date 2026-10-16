import { Module, type DynamicModule } from '@nestjs/common';
import { AnticiposModule } from './modules/anticipos/anticipos.module';
import { ComprobantesModule } from './modules/comprobantes/comprobantes.module';
import { IdentidadModule } from './modules/identidad/identidad.module';
import { LegalizacionesModule } from './modules/legalizaciones/legalizaciones.module';
import { TasasModule } from './modules/tasas/tasas.module';
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
      imports: [SharedModule.forRoot(configuracion), TasasModule, IdentidadModule, TarifasModule, SolicitudesModule, AnticiposModule, LegalizacionesModule, ComprobantesModule],
      controllers: [SaludController],
    };
  }
}
