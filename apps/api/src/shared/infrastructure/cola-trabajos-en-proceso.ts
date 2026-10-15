import { Logger } from '@nestjs/common';

/**
 * Cola en proceso con concurrencia limitada. Si el servidor se reinicia, cada
 * módulo reencola lo pendiente al arrancar. Reemplazable por pg-boss (ADR-0004).
 */
export class ColaTrabajosEnProceso {
  private readonly logger = new Logger('ColaTrabajos');
  private readonly pendientes: Array<{ nombre: string; trabajo: () => Promise<void> }> = [];
  private enCurso = 0;
  private readonly enCola = new Set<string>();
  private inactivo: Promise<void> = Promise.resolve();
  private liberar: (() => void) | null = null;

  constructor(private readonly concurrencia = 2) {}

  encolar(nombre: string, trabajo: () => Promise<void>): void {
    if (this.enCola.has(nombre)) return; // el mismo trabajo no se encola dos veces
    this.enCola.add(nombre);
    if (!this.liberar) this.inactivo = new Promise((r) => (this.liberar = r));
    this.pendientes.push({ nombre, trabajo });
    this.siguiente();
  }

  /** Para pruebas: espera a que la cola quede vacía. */
  esperarInactividad(): Promise<void> {
    return this.inactivo;
  }

  private siguiente(): void {
    while (this.enCurso < this.concurrencia && this.pendientes.length) {
      const { nombre, trabajo } = this.pendientes.shift()!;
      this.enCurso++;
      void trabajo()
        .catch((error: unknown) => this.logger.error(`Falló ${nombre}: ${error instanceof Error ? error.stack : String(error)}`))
        .finally(() => {
          this.enCurso--;
          this.enCola.delete(nombre);
          if (this.enCurso === 0 && this.pendientes.length === 0) {
            this.liberar?.();
            this.liberar = null;
          }
          this.siguiente();
        });
    }
  }
}
