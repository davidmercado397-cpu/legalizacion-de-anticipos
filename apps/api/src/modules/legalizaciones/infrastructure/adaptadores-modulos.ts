import type { BusEventos } from '../../../shared/application/puertos';
import type { AnticipoDesembolsado } from '../../anticipos/application/eventos-publicos';
import type { CargoSinSoporteDecidido, EstadoBancarioActualizado } from '../../conciliacion/application/eventos-publicos';
import type { ControlDuplicados } from '../../comprobantes/application/control-duplicados';
import type { ConsultarUsuarioUseCase } from '../../organizacion/application/consultar-usuario.use-case';
import type { GestionLegalizaciones } from '../application/legalizaciones.use-cases';
import type { ControlDuplicadosPort, DirectorioEmpresas, HuellaSoporte } from '../application/puertos';

/** Al desembolsar el anticipo se abre su legalización. */
export function suscribirAperturaDeLegalizaciones(bus: BusEventos, legalizaciones: GestionLegalizaciones): void {
  bus.suscribir<AnticipoDesembolsado>('anticipos.AnticipoDesembolsado', async (e) => {
    await legalizaciones.abrirParaAnticipo({
      anticipoId: e.agregadoId,
      viajeroId: e.viajeroId,
      monto: e.monto,
      viajeInicio: e.viajeInicio,
      viajeFin: e.viajeFin,
    });
  });
}

/** La conciliación bancaria ajusta los pagos con tarjeta y registra los cargos descontados al viajero. */
export function suscribirResultadosDeConciliacion(bus: BusEventos, legalizaciones: GestionLegalizaciones): void {
  bus.suscribir<EstadoBancarioActualizado>('conciliacion.EstadoBancarioActualizado', (e) => legalizaciones.aplicarEstadoBancario(e));
  bus.suscribir<CargoSinSoporteDecidido>('conciliacion.CargoSinSoporteDecidido', (e) => legalizaciones.aplicarDescuento(e));
}

/** Capa anticorrupción hacia el módulo de comprobantes (detección de duplicados). */
export class ControlDuplicadosAdapter implements ControlDuplicadosPort {
  constructor(private readonly control: ControlDuplicados) {}

  archivoYaRadicado(sha256: string): Promise<boolean> {
    return this.control.archivoYaRadicado(sha256);
  }

  async registrar(soporteId: string, viajeroId: string, huella: HuellaSoporte) {
    const resultado = await this.control.registrar(soporteId, viajeroId, huella);
    return {
      veredicto: resultado.veredicto === 'SOSPECHOSO' ? ('SOSPECHOSO' as const) : ('UNICO' as const),
      detalle: resultado.coincidencias[0]?.detalle ?? null,
    };
  }

  anular(soporteId: string): Promise<void> {
    return this.control.anular(soporteId);
  }
}

/** Capa anticorrupción hacia organización: empresa (y NIT) del viajero. */
export class DirectorioEmpresasAdapter implements DirectorioEmpresas {
  constructor(private readonly usuarios: ConsultarUsuarioUseCase) {}

  async empresaDe(viajeroId: string) {
    const empresa = await this.usuarios.empresaDe(viajeroId);
    return empresa && { nombre: empresa.nombre, nit: empresa.nit };
  }
}
