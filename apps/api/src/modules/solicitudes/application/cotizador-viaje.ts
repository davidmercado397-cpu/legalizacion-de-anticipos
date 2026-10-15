import { DomainError, type MonedaAnticipo } from '@viaticos/shared-kernel';
import type { ProveedorTasaCambio, Reloj } from '../../../shared/application/puertos';
import { Destino } from '../domain/destino';
import { crearReglasEscalamiento } from '../domain/escalamiento/fabrica-reglas';
import { evaluarEscalamiento, type ResultadoEscalamiento } from '../domain/escalamiento/regla-escalamiento';
import { estimarPresupuesto, type PresupuestoViaje } from '../domain/presupuesto-viaje';
import type { ConfiguracionEscalamientoRepository } from '../domain/repositorios';
import type { ConsultaTarifas, DirectorioOrganizacional, PerfilViajero } from './puertos';

export interface CotizarViajeComando {
  viajeroId: string;
  monedaAnticipo: MonedaAnticipo;
  destinos: ReadonlyArray<{
    paisCodigo: string;
    ciudad: string;
    fechaInicio: string;
    fechaFin: string;
    valoresSolicitados: ReadonlyArray<{ conceptoCodigo: string; valorUnitario: string }>;
  }>;
}

export interface Cotizacion {
  viajero: PerfilViajero;
  destinos: Destino[];
  presupuesto: PresupuestoViaje;
  escalamiento: ResultadoEscalamiento;
}

/**
 * Servicio de aplicación compartido por "estimar" y "crear solicitud":
 * reúne tarifas, tasas y reglas, y delega el cálculo al dominio.
 */
export class CotizadorViaje {
  constructor(
    private readonly directorio: DirectorioOrganizacional,
    private readonly tarifas: ConsultaTarifas,
    private readonly tasas: ProveedorTasaCambio,
    private readonly configuracion: ConfiguracionEscalamientoRepository,
    private readonly reloj: Reloj,
  ) {}

  async cotizar(comando: CotizarViajeComando): Promise<Cotizacion> {
    const viajero = await this.directorio.obtenerViajero(comando.viajeroId);
    if (!viajero) {
      throw new DomainError('VIAJERO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El viajero no existe o está inactivo');
    }

    const hoy = this.reloj.hoy();
    const destinos = comando.destinos.map((d) => Destino.crear(d));

    const paises = [...new Set(destinos.map((d) => d.paisCodigo))];
    const tarifasPorPais = new Map(
      await Promise.all(
        paises.map(async (pais) => [pais, await this.tarifas.vigentes(viajero.cargoId, pais, hoy)] as const),
      ),
    );

    const monedasAConvertir = new Set(
      [...tarifasPorPais.values()]
        .flat()
        .map((t) => t.valorUnitario.moneda)
        .filter((m) => m !== comando.monedaAnticipo),
    );
    const tasas = await Promise.all(
      [...monedasAConvertir].map((m) => this.tasas.obtener(m, comando.monedaAnticipo, hoy)),
    );

    const presupuesto = estimarPresupuesto({
      monedaAnticipo: comando.monedaAnticipo,
      tasas,
      destinos: destinos.map((destino, i) => ({
        destino,
        tarifas: tarifasPorPais.get(destino.paisCodigo) ?? [],
        valoresSolicitados: new Map(
          comando.destinos[i]!.valoresSolicitados.map((v) => [v.conceptoCodigo, v.valorUnitario]),
        ),
      })),
    });

    const reglas = crearReglasEscalamiento(await this.configuracion.obtener());
    return { viajero, destinos, presupuesto, escalamiento: evaluarEscalamiento(presupuesto, reglas) };
  }
}
