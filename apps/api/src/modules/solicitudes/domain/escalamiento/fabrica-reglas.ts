import { DomainError, Money, type MoneyDto } from '@viaticos/shared-kernel';
import { ExcedeTarifaRegla } from './excede-tarifa.regla';
import { MontoTotalSuperaRegla } from './monto-total-supera.regla';
import type { ReglaEscalamiento } from './regla-escalamiento';

/** Configuración administrable de las reglas de escalamiento (se guarda en BD). */
export type ConfiguracionReglaEscalamiento =
  | { tipo: 'EXCEDE_TARIFA'; activa: boolean; parametros: { toleranciaPorcentaje: number } }
  | { tipo: 'MONTO_TOTAL_SUPERA'; activa: boolean; parametros: { umbrales: MoneyDto[] } };

type TipoRegla = ConfiguracionReglaEscalamiento['tipo'];
type ParametrosDe<T extends TipoRegla> = Extract<ConfiguracionReglaEscalamiento, { tipo: T }>['parametros'];

/** Registro tipo → constructor. Una regla nueva = un tipo nuevo + una entrada aquí (abierto/cerrado). */
const REGISTRO: { [T in TipoRegla]: (parametros: ParametrosDe<T>) => ReglaEscalamiento } = {
  EXCEDE_TARIFA: (p) => new ExcedeTarifaRegla(p.toleranciaPorcentaje),
  MONTO_TOTAL_SUPERA: (p) => new MontoTotalSuperaRegla(p.umbrales.map(Money.fromDto)),
};

export function crearReglasEscalamiento(
  configuraciones: readonly ConfiguracionReglaEscalamiento[],
): ReglaEscalamiento[] {
  return configuraciones
    .filter((c) => c.activa)
    .map((c) => {
      const crear = REGISTRO[c.tipo] as ((p: typeof c.parametros) => ReglaEscalamiento) | undefined;
      if (!crear) {
        throw new DomainError('REGLA_DESCONOCIDA', 'CONFLICTO', `Tipo de regla desconocido: ${String(c.tipo)}`);
      }
      return crear(c.parametros);
    });
}
