import { describe, expect, it } from 'vitest';
import { EXCLUSIONES_POR_DEFECTO, ReglaExclusion, evaluarExclusion } from './reglas-exclusion';

const reglas = EXCLUSIONES_POR_DEFECTO.map((c) => new ReglaExclusion(c));
const motivo = (texto: string) => evaluarExclusion(texto, reglas)?.config.codigo ?? null;

describe('reglas de exclusión', () => {
  it.each([
    ['2 CERVEZA CLUB COLOMBIA', 'LICOR'],
    ['Heineken beer 330ml', 'LICOR'],
    ['Cerveja Brahma', 'LICOR'],
    ['Caipirinha limão', 'LICOR'],
    ['Copa de vino tinto', 'LICOR'],
    ['Consumo MINI-BAR hab 302', 'MINIBAR'],
    ['Frigobar', 'MINIBAR'],
    ['Cigarrillos Marlboro', 'TABACO'],
  ])('"%s" → %s', (texto, esperado) => {
    expect(motivo(texto)).toBe(esperado);
  });

  it.each(['Bandeja paisa', 'Agua sin gas', 'Taxi aeropuerto', 'Vinagreta de la casa', 'Ronda de café', 'Ginger ale', 'Cervecería (nombre del local)'])(
    'no excluye "%s" (palabra completa, no subcadena)',
    (texto) => {
      expect(motivo(texto)).toBeNull();
    },
  );

  it('ignora tildes y mayúsculas', () => {
    expect(new ReglaExclusion({ codigo: 'X', nombre: 'X', palabras: ['champaña'] }).aplicaA('CHAMPANA rosé')).toBe(true);
  });
});
