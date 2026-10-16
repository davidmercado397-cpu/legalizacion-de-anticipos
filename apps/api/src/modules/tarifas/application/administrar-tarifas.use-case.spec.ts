import { FechaCalendario, Money } from '@viaticos/shared-kernel';
import { describe, expect, it } from 'vitest';
import { Tarifa } from '../domain/tarifa';
import { ConceptoViaticoRepositoryEnMemoria, TarifaRepositoryEnMemoria } from '../infrastructure/repositorios.memoria';
import { AdministrarTarifasUseCase } from './administrar-tarifas.use-case';

function preparar() {
  const tarifas = new TarifaRepositoryEnMemoria([
    Tarifa.crear({
      id: 't-hotel',
      cargoId: 'ANALISTA',
      paisCodigo: 'BR',
      conceptoCodigo: 'ALOJAMIENTO',
      valorUnitario: Money.of(30, 'USD'),
      vigenteDesde: FechaCalendario.of('2026-01-01'),
      vigenteHasta: null,
    }),
  ]);
  const conceptos = new ConceptoViaticoRepositoryEnMemoria([{ codigo: 'ALOJAMIENTO', nombre: 'Alojamiento', unidad: 'NOCHE', activo: true }]);
  let n = 0;
  return { tarifas, uc: new AdministrarTarifasUseCase(tarifas, conceptos, { nuevo: () => `nueva-${++n}` }) };
}

const nueva = { cargoId: 'analista', paisCodigo: 'br', conceptoCodigo: 'ALOJAMIENTO', valor: '35', moneda: 'usd', vigenteHasta: null };

describe('AdministrarTarifasUseCase', () => {
  it('una tarifa nueva cierra la anterior el día antes y conserva el historial', async () => {
    const { uc, tarifas } = preparar();
    await uc.crearTarifa({ ...nueva, vigenteDesde: '2026-11-01' });
    const todas = await tarifas.listar({ cargoId: 'ANALISTA' });
    expect(todas.map((t) => [t.id, t.valorUnitario.monto, t.vigenteDesde.toString(), t.vigenteHasta?.toString() ?? null])).toEqual([
      ['t-hotel', '30.00', '2026-01-01', '2026-10-31'],
      ['nueva-1', '35.00', '2026-11-01', null],
    ]);
  });

  it('rechaza tarifas que se cruzan con una ya cerrada o futura', async () => {
    const { uc } = preparar();
    await uc.crearTarifa({ ...nueva, vigenteDesde: '2026-11-01' });
    await expect(uc.crearTarifa({ ...nueva, vigenteDesde: '2026-06-01', vigenteHasta: '2026-12-31' })).rejects.toMatchObject({ codigo: 'TARIFAS_SOLAPADAS' });
  });

  it('valida el concepto y su código', async () => {
    const { uc } = preparar();
    await expect(uc.crearTarifa({ ...nueva, conceptoCodigo: 'LAVANDERIA', vigenteDesde: '2026-11-01' })).rejects.toMatchObject({ codigo: 'CONCEPTO_NO_ENCONTRADO' });
    await expect(uc.guardarConcepto({ codigo: 'lavandería!', nombre: 'Lavandería', unidad: 'DIA', activo: true })).rejects.toMatchObject({ codigo: 'CODIGO_INVALIDO' });
    expect(await uc.guardarConcepto({ codigo: 'lavanderia', nombre: 'Lavandería', unidad: 'DIA', activo: true })).toMatchObject({ codigo: 'LAVANDERIA' });
  });
});
