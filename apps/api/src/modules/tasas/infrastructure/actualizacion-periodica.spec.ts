import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActualizacionPeriodica } from './actualizacion-periodica';

describe('ActualizacionPeriodica', () => {
  afterEach(() => vi.useRealTimers());

  it('ejecuta al iniciar y en cada intervalo; un fallo no detiene las siguientes', async () => {
    vi.useFakeTimers();
    const tarea = vi.fn().mockRejectedValueOnce(new Error('red caída')).mockResolvedValue(undefined);
    const alFallar = vi.fn();
    const a = new ActualizacionPeriodica(tarea, alFallar, 1000);
    a.iniciar();
    await vi.advanceTimersByTimeAsync(2500);
    expect(tarea).toHaveBeenCalledTimes(3);
    expect(alFallar).toHaveBeenCalledTimes(1);
    a.detener();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tarea).toHaveBeenCalledTimes(3);
  });
});
