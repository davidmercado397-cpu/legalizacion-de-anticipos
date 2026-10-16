/**
 * Ejecuta una tarea al arrancar y luego cada `intervaloMs` (por defecto cada hora).
 * Para las tasas: la TRM del día se publica el día hábil anterior y el BCE la suya
 * por la tarde; consultar cada hora hace que el cambio de día se refleje solo, y una
 * vez guardada la tasa definitiva la consulta sale de la caché sin ir a la red.
 */
export class ActualizacionPeriodica {
  private temporizador: NodeJS.Timeout | null = null;

  constructor(
    private readonly tarea: () => Promise<void>,
    private readonly alFallar: (error: unknown) => void,
    private readonly intervaloMs = 60 * 60 * 1000,
  ) {}

  iniciar(): void {
    if (this.temporizador) return;
    void this.ejecutar();
    this.temporizador = setInterval(() => void this.ejecutar(), this.intervaloMs);
    this.temporizador.unref();
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }

  private async ejecutar(): Promise<void> {
    try {
      await this.tarea();
    } catch (error) {
      this.alFallar(error);
    }
  }
}
