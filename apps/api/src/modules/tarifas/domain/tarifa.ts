import { DomainError, invariante, type FechaCalendario, type Money } from '@viaticos/shared-kernel';

export interface TarifaProps {
  id: string;
  cargoId: string;
  paisCodigo: string;
  conceptoCodigo: string;
  valorUnitario: Money;
  vigenteDesde: FechaCalendario;
  vigenteHasta: FechaCalendario | null;
}

/** Valor máximo por día/noche de un concepto, para un cargo y un país, en un periodo de vigencia. */
export class Tarifa {
  private constructor(private readonly props: TarifaProps) {}

  static crear(props: TarifaProps): Tarifa {
    invariante(/^[A-Z]{2}$/.test(props.paisCodigo), 'PAIS_INVALIDO', `País inválido: ${props.paisCodigo}`);
    invariante(!props.valorUnitario.esNegativo(), 'TARIFA_NEGATIVA', 'La tarifa no puede ser negativa');
    invariante(
      !props.vigenteHasta || !props.vigenteHasta.esAnteriorA(props.vigenteDesde),
      'VIGENCIA_INVALIDA',
      'La vigencia termina antes de empezar',
    );
    return new Tarifa(props);
  }

  get id(): string {
    return this.props.id;
  }
  get cargoId(): string {
    return this.props.cargoId;
  }
  get paisCodigo(): string {
    return this.props.paisCodigo;
  }
  get conceptoCodigo(): string {
    return this.props.conceptoCodigo;
  }
  get valorUnitario(): Money {
    return this.props.valorUnitario;
  }

  estaVigenteEn(fecha: FechaCalendario): boolean {
    const { vigenteDesde, vigenteHasta } = this.props;
    return !fecha.esAnteriorA(vigenteDesde) && (!vigenteHasta || !fecha.esPosteriorA(vigenteHasta));
  }
}

/**
 * Devuelve una tarifa vigente por concepto. Dos tarifas vigentes para el mismo
 * concepto es un error de configuración que no debe resolverse en silencio.
 */
export function seleccionarTarifasVigentes(tarifas: readonly Tarifa[], fecha: FechaCalendario): Tarifa[] {
  const porConcepto = new Map<string, Tarifa>();
  for (const tarifa of tarifas.filter((t) => t.estaVigenteEn(fecha))) {
    const previa = porConcepto.get(tarifa.conceptoCodigo);
    if (previa) {
      throw new DomainError(
        'TARIFAS_SOLAPADAS',
        'CONFLICTO',
        `Hay más de una tarifa vigente para ${tarifa.conceptoCodigo} en ${tarifa.paisCodigo}`,
        { tarifas: [previa.id, tarifa.id] },
      );
    }
    porConcepto.set(tarifa.conceptoCodigo, tarifa);
  }
  return [...porConcepto.values()];
}
