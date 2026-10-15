import type { FechaCalendario, Money } from '@viaticos/shared-kernel';
import type { UnidadCobro } from '../domain/concepto-viatico';
import type { ConceptoViaticoRepository, TarifaRepository } from '../domain/repositorios';
import { seleccionarTarifasVigentes } from '../domain/tarifa';

export interface TarifaVigente {
  tarifaId: string;
  conceptoCodigo: string;
  conceptoNombre: string;
  unidad: UnidadCobro;
  valorUnitario: Money;
}

/** API pública del módulo de tarifas. */
export class ConsultarTarifasVigentesUseCase {
  constructor(
    private readonly tarifas: TarifaRepository,
    private readonly conceptos: ConceptoViaticoRepository,
  ) {}

  async ejecutar(cargoId: string, paisCodigo: string, fecha: FechaCalendario): Promise<TarifaVigente[]> {
    const [tarifas, conceptos] = await Promise.all([
      this.tarifas.buscarPorCargoYPais(cargoId, paisCodigo),
      this.conceptos.listar(),
    ]);
    const conceptosActivos = new Map(conceptos.filter((c) => c.activo).map((c) => [c.codigo, c]));

    return seleccionarTarifasVigentes(tarifas, fecha).flatMap((t) => {
      const concepto = conceptosActivos.get(t.conceptoCodigo);
      return concepto
        ? [
            {
              tarifaId: t.id,
              conceptoCodigo: concepto.codigo,
              conceptoNombre: concepto.nombre,
              unidad: concepto.unidad,
              valorUnitario: t.valorUnitario,
            },
          ]
        : [];
    });
  }
}
