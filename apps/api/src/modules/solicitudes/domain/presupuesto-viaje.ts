import {
  DomainError,
  Money,
  invariante,
  type MonedaAnticipo,
  type TasaCambio,
} from '@viaticos/shared-kernel';
import { calcularUnidades } from './calculadora-unidades';
import type { Destino } from './destino';

export type UnidadCobro = 'NOCHE' | 'DIA';

/** Tarifa vigente tal como la necesita este contexto (viene del módulo de tarifas). */
export interface TarifaAplicable {
  tarifaId: string;
  conceptoCodigo: string;
  conceptoNombre: string;
  unidad: UnidadCobro;
  valorUnitario: Money;
}

export interface LineaPresupuestoProps {
  destinoIndice: number;
  paisCodigo: string;
  conceptoCodigo: string;
  conceptoNombre: string;
  unidad: UnidadCobro;
  cantidad: number;
  tarifaId: string;
  tarifaUnitaria: Money;
  valorUnitarioSolicitado: Money;
}

export class LineaPresupuesto {
  private constructor(private readonly props: LineaPresupuestoProps) {}

  static crear(props: LineaPresupuestoProps): LineaPresupuesto {
    invariante(Number.isInteger(props.cantidad) && props.cantidad >= 0, 'CANTIDAD_INVALIDA', 'Cantidad inválida');
    invariante(
      props.valorUnitarioSolicitado.moneda === props.tarifaUnitaria.moneda,
      'MONEDA_DISTINTA_A_TARIFA',
      `El valor de ${props.conceptoCodigo} debe estar en ${props.tarifaUnitaria.moneda}`,
    );
    invariante(!props.valorUnitarioSolicitado.esNegativo(), 'VALOR_NEGATIVO', 'El valor no puede ser negativo');
    return new LineaPresupuesto(props);
  }

  get destinoIndice(): number {
    return this.props.destinoIndice;
  }
  get paisCodigo(): string {
    return this.props.paisCodigo;
  }
  get conceptoCodigo(): string {
    return this.props.conceptoCodigo;
  }
  get conceptoNombre(): string {
    return this.props.conceptoNombre;
  }
  get unidad(): UnidadCobro {
    return this.props.unidad;
  }
  get cantidad(): number {
    return this.props.cantidad;
  }
  get tarifaId(): string {
    return this.props.tarifaId;
  }
  get tarifaUnitaria(): Money {
    return this.props.tarifaUnitaria;
  }
  get valorUnitarioSolicitado(): Money {
    return this.props.valorUnitarioSolicitado;
  }

  get subtotal(): Money {
    return this.props.valorUnitarioSolicitado.multiplicar(this.props.cantidad);
  }

  get excedeTarifa(): boolean {
    return this.excedeConTolerancia(0);
  }

  /** ¿El valor unitario supera la tarifa más un porcentaje de tolerancia? */
  excedeConTolerancia(toleranciaPorcentaje: number): boolean {
    const limite = this.props.tarifaUnitaria.multiplicar(1 + toleranciaPorcentaje / 100);
    return this.props.valorUnitarioSolicitado.esMayorQue(limite);
  }

  toProps(): LineaPresupuestoProps {
    return { ...this.props };
  }
}

/** Presupuesto del viaje: líneas por destino y concepto, total en la moneda del anticipo. */
export class PresupuestoViaje {
  private constructor(
    readonly monedaAnticipo: MonedaAnticipo,
    readonly lineas: readonly LineaPresupuesto[],
    readonly tasas: readonly TasaCambio[],
  ) {}

  static crear(monedaAnticipo: MonedaAnticipo, lineas: readonly LineaPresupuesto[], tasas: readonly TasaCambio[]) {
    invariante(lineas.length > 0, 'PRESUPUESTO_VACIO', 'El presupuesto no tiene líneas');
    for (const moneda of new Set(lineas.map((l) => l.tarifaUnitaria.moneda))) {
      if (moneda !== monedaAnticipo && !tasas.some((t) => t.origen === moneda && t.destino === monedaAnticipo)) {
        throw new DomainError('TASA_FALTANTE', 'REGLA_NEGOCIO', `Falta la tasa ${moneda}->${monedaAnticipo}`);
      }
    }
    return new PresupuestoViaje(monedaAnticipo, [...lineas], [...tasas]);
  }

  /** Se suma por moneda y luego se convierte, para no acumular redondeos por línea. */
  get totalAnticipo(): Money {
    return this.totalesPorMoneda().reduce(
      (total, subtotal) => total.sumar(this.aMonedaAnticipo(subtotal)),
      Money.cero(this.monedaAnticipo),
    );
  }

  totalesPorMoneda(): Money[] {
    const porMoneda = new Map<string, Money>();
    for (const linea of this.lineas) {
      const moneda = linea.subtotal.moneda;
      porMoneda.set(moneda, (porMoneda.get(moneda) ?? Money.cero(moneda)).sumar(linea.subtotal));
    }
    return [...porMoneda.values()];
  }

  /** Tasas efectivamente usadas para convertir (sin las identidades). */
  get tasasAplicadas(): TasaCambio[] {
    const monedas = new Set(this.lineas.map((l) => l.subtotal.moneda));
    return this.tasas.filter((t) => monedas.has(t.origen) && t.origen !== t.destino);
  }

  aMonedaAnticipo(valor: Money): Money {
    if (valor.moneda === this.monedaAnticipo) return valor;
    const tasa = this.tasas.find((t) => t.origen === valor.moneda && t.destino === this.monedaAnticipo);
    if (!tasa) throw new DomainError('TASA_FALTANTE', 'REGLA_NEGOCIO', `Falta la tasa ${valor.moneda}`);
    return valor.convertir(tasa);
  }
}

export interface DestinoACotizar {
  destino: Destino;
  tarifas: readonly TarifaAplicable[];
  /** conceptoCodigo → valor unitario propuesto por el viajero (decimal en la moneda de la tarifa). */
  valoresSolicitados: ReadonlyMap<string, string>;
}

/**
 * Servicio de dominio: arma el presupuesto a partir de destinos y tarifas.
 * Si el viajero no propone un valor, se usa la tarifa.
 */
export function estimarPresupuesto(entrada: {
  monedaAnticipo: MonedaAnticipo;
  destinos: readonly DestinoACotizar[];
  tasas: readonly TasaCambio[];
}): PresupuestoViaje {
  const unidades = calcularUnidades(entrada.destinos.map((d) => d.destino));

  const lineas = entrada.destinos.flatMap(({ destino, tarifas, valoresSolicitados }, destinoIndice) => {
    if (tarifas.length === 0) {
      throw new DomainError(
        'TARIFA_NO_DEFINIDA',
        'REGLA_NEGOCIO',
        `No hay tarifas vigentes para ${destino.paisCodigo} en el cargo del viajero`,
        { paisCodigo: destino.paisCodigo },
      );
    }
    for (const concepto of valoresSolicitados.keys()) {
      if (!tarifas.some((t) => t.conceptoCodigo === concepto)) {
        throw new DomainError('CONCEPTO_SIN_TARIFA', 'VALIDACION', `El concepto ${concepto} no tiene tarifa`, {
          conceptoCodigo: concepto,
          paisCodigo: destino.paisCodigo,
        });
      }
    }

    const { dias, noches } = unidades[destinoIndice]!;
    return tarifas
      .map((tarifa) => ({ tarifa, cantidad: tarifa.unidad === 'NOCHE' ? noches : dias }))
      .filter(({ cantidad }) => cantidad > 0)
      .map(({ tarifa, cantidad }) => {
        const propuesto = valoresSolicitados.get(tarifa.conceptoCodigo);
        return LineaPresupuesto.crear({
          destinoIndice,
          paisCodigo: destino.paisCodigo,
          conceptoCodigo: tarifa.conceptoCodigo,
          conceptoNombre: tarifa.conceptoNombre,
          unidad: tarifa.unidad,
          cantidad,
          tarifaId: tarifa.tarifaId,
          tarifaUnitaria: tarifa.valorUnitario,
          valorUnitarioSolicitado:
            propuesto === undefined ? tarifa.valorUnitario : Money.of(propuesto, tarifa.valorUnitario.moneda),
        });
      });
  });

  return PresupuestoViaje.crear(entrada.monedaAnticipo, lineas, entrada.tasas);
}
