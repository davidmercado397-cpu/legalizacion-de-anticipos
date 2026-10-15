import { describe, expect, it } from 'vitest';
import { DetectorDuplicados } from '../domain/duplicados/detector-duplicados';
import { HuellaRepositoryEnMemoria } from '../infrastructure/huella.repository.memoria';
import { ControlDuplicados } from './control-duplicados';

const sha = (n: number) => n.toString(16).padStart(64, '0');
const nuevoControl = () => new ControlDuplicados(new HuellaRepositoryEnMemoria(), new DetectorDuplicados());

describe('ControlDuplicados', () => {
  it('registra un comprobante único y bloquea el mismo archivo después', async () => {
    const control = nuevoControl();
    await control.registrar('c1', 'ana', { sha256: sha(1) });
    expect((await control.verificar({ sha256: sha(1) })).veredicto).toBe('DUPLICADO');
    await expect(control.registrar('c2', 'luis', { sha256: sha(1) })).rejects.toThrowError(/ya fue radicado/);
  });

  it('un comprobante anulado deja de bloquear', async () => {
    const repo = new HuellaRepositoryEnMemoria();
    const control = new ControlDuplicados(repo, new DetectorDuplicados());
    await control.registrar('c1', 'ana', { sha256: sha(1) });
    await repo.anular('c1');
    expect((await control.verificar({ sha256: sha(1) })).veredicto).toBe('UNICO');
  });

  it('registra los sospechosos y devuelve las coincidencias para revisión contable', async () => {
    const control = nuevoControl();
    const base = { emisorId: '900123456', fecha: '2026-11-03', total: { monto: '85000', moneda: 'COP' } };
    await control.registrar('c1', 'ana', { ...base, sha256: sha(1), numeroDocumento: '1' });
    const resultado = await control.registrar('c2', 'ana', { ...base, sha256: sha(2), numeroDocumento: '2' });
    expect(resultado.veredicto).toBe('SOSPECHOSO');
  });

  it('re-verificar un comprobante ya registrado no lo marca como duplicado de sí mismo', async () => {
    const control = nuevoControl();
    await control.registrar('c1', 'ana', { sha256: sha(1), emisorId: '900123456', numeroDocumento: 'FE1' });
    expect(
      (await control.verificar({ sha256: sha(1), emisorId: '900123456', numeroDocumento: 'FE1' }, 'c1')).veredicto,
    ).toBe('UNICO');
  });
});
