import type { ConfiguracionReglaEscalamiento } from '../domain/escalamiento/fabrica-reglas';
import type { ConfiguracionEscalamientoRepository } from '../domain/repositorios';

export class ConfiguracionEscalamientoEnMemoria implements ConfiguracionEscalamientoRepository {
  constructor(private configuracion: ConfiguracionReglaEscalamiento[]) {}

  async obtener(): Promise<ConfiguracionReglaEscalamiento[]> {
    return structuredClone(this.configuracion);
  }

  reemplazar(configuracion: ConfiguracionReglaEscalamiento[]): void {
    this.configuracion = structuredClone(configuracion);
  }
}

export const CONFIGURACION_ESCALAMIENTO_DESARROLLO: ConfiguracionReglaEscalamiento[] = [
  { tipo: 'EXCEDE_TARIFA', activa: true, parametros: { toleranciaPorcentaje: 0 } },
  {
    tipo: 'MONTO_TOTAL_SUPERA',
    activa: true,
    parametros: {
      umbrales: [
        { monto: '3000', moneda: 'USD' },
        { monto: '12000000', moneda: 'COP' },
      ],
    },
  },
];
