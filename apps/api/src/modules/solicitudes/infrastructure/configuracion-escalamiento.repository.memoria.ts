import type { ConfiguracionReglaEscalamiento } from '../domain/escalamiento/fabrica-reglas';
import type { ConfiguracionEscalamientoRepository } from '../domain/repositorios';

export class ConfiguracionEscalamientoEnMemoria implements ConfiguracionEscalamientoRepository {
  private actualizado: { actualizadoPor: string | null; actualizadoEn: Date | null } = { actualizadoPor: null, actualizadoEn: null };

  constructor(private configuracion: ConfiguracionReglaEscalamiento[]) {}

  async obtener(): Promise<ConfiguracionReglaEscalamiento[]> {
    return structuredClone(this.configuracion);
  }

  async auditoria() {
    return { ...this.actualizado };
  }

  async guardar(configuracion: readonly ConfiguracionReglaEscalamiento[], usuarioId: string, ahora: Date) {
    this.configuracion = structuredClone([...configuracion]);
    this.actualizado = { actualizadoPor: usuarioId, actualizadoEn: ahora };
  }

  reemplazar(configuracion: ConfiguracionReglaEscalamiento[]): void {
    this.configuracion = structuredClone(configuracion);
  }
}

export const CONFIGURACION_ESCALAMIENTO_DESARROLLO: ConfiguracionReglaEscalamiento[] = [
  // Decisión del negocio: se tolera hasta 10 % sobre la tarifa antes de escalar al directivo.
  { tipo: 'EXCEDE_TARIFA', activa: true, parametros: { toleranciaPorcentaje: 10 } },
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
