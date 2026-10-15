/**
 * Exclusiones de la política (licor, minibar, tabaco…), configurables por
 * contabilidad. Se aplican por LÍNEA: en una cena con cerveza se legaliza la
 * comida y la cerveza queda a cargo del viajero.
 */
export interface ConfiguracionExclusion {
  codigo: string;
  nombre: string;
  /** Palabras o frases en es/pt/en. Se comparan sin tildes ni mayúsculas, por palabra completa. */
  palabras: string[];
}

const normalizar = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export class ReglaExclusion {
  private readonly patron: RegExp | null;

  constructor(readonly config: ConfiguracionExclusion) {
    const palabras = config.palabras.map((p) => normalizar(p).trim()).filter(Boolean);
    const escapadas = palabras.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
    this.patron = escapadas.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(${escapadas.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'u') : null;
  }

  aplicaA(descripcion: string): boolean {
    return this.patron?.test(normalizar(descripcion)) ?? false;
  }
}

/** Primera regla que excluye la descripción, o null. */
export function evaluarExclusion(descripcion: string, reglas: readonly ReglaExclusion[]): ReglaExclusion | null {
  return reglas.find((r) => r.aplicaA(descripcion)) ?? null;
}

export const EXCLUSIONES_POR_DEFECTO: ConfiguracionExclusion[] = [
  {
    codigo: 'LICOR',
    nombre: 'Bebidas alcohólicas',
    palabras: [
      'cerveza', 'cervezas', 'beer', 'cerveja', 'chopp', 'vino', 'wine', 'vinho', 'whisky', 'whiskey', 'ron', 'rum',
      'aguardiente', 'tequila', 'vodka', 'gin', 'ginebra', 'licor', 'liquor', 'coctel', 'cocktail', 'caipirinha',
      'sangria', 'champagne', 'champana', 'espumante', 'pisco', 'mezcal', 'cachaca',
    ],
  },
  { codigo: 'MINIBAR', nombre: 'Minibar', palabras: ['minibar', 'mini bar', 'frigobar', 'mini-bar'] },
  { codigo: 'TABACO', nombre: 'Tabaco', palabras: ['cigarrillo', 'cigarrillos', 'cigarette', 'cigarettes', 'cigarro', 'tabaco', 'tobacco', 'vape'] },
];
