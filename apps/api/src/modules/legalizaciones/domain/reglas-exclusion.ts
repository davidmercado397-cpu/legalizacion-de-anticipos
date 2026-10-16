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
  /** Palabras que también tienen otro sentido: la línea no se excluye sola, queda por verificar. */
  palabrasAmbiguas?: string[];
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
      // Genéricos (es / pt / en)
      'licor', 'licores', 'liquor', 'alcohol', 'alcoholica', 'alcoholicas', 'bebida alcoholica', 'bebidas alcoholicas', 'bebida alcoolica',
      'trago', 'tragos', 'copa de vino', 'botella de vino', 'happy hour', 'open bar', 'barra libre',
      // Cervezas
      'cerveza', 'cervezas', 'cerveja', 'cervejas', 'beer', 'beers', 'chopp', 'chope', 'lager', 'ipa', 'stout', 'pilsen', 'michelada',
      'club colombia', 'heineken', 'budweiser', 'stella artois', 'brahma', 'skol', 'antarctica', 'bohemia', 'pilsener',
      // Vinos y espumosos
      'vino', 'vinos', 'vinho', 'vinhos', 'wine', 'wines', 'tinto reserva', 'malbec', 'cabernet', 'merlot', 'chardonnay', 'sauvignon', 'carmenere',
      'rose wine', 'prosecco', 'champagne', 'champana', 'espumante', 'espumoso', 'sangria', 'vermut', 'vermouth', 'jerez', 'sherry', 'oporto',
      // Destilados
      'whisky', 'whiskey', 'bourbon', 'scotch', 'rum', 'aguardiente', 'guaro', 'antioqueno', 'tequila', 'mezcal', 'vodka', 'ginebra',
      'brandy', 'cognac', 'conac', 'pisco', 'cachaca', 'pinga', 'grappa', 'sambuca', 'jagermeister', 'baileys', 'amaretto', 'soju',
      // Cocteles
      'coctel', 'cocteles', 'coquetel', 'cocktail', 'cocktails', 'caipirinha', 'caipiroska', 'caipivodka', 'mojito', 'pina colada',
      'daiquiri', 'cuba libre', 'gin tonic', 'negroni', 'spritz', 'aperol', 'martini', 'cosmopolitan', 'bloody mary', 'canelazo', 'refajo',
    ],
    // También son platos, marcas o palabras comunes ("pizza margarita", "sake nigiri"): la línea queda por verificar.
    palabrasAmbiguas: ['ron', 'gin', 'shot', 'shots', 'drink', 'drinks', 'clara', 'corona', 'poker', 'aguila', 'ale', 'cava', 'anis', 'margarita', 'mimosa', 'sake'],
  },
  { codigo: 'MINIBAR', nombre: 'Minibar', palabras: ['minibar', 'mini bar', 'frigobar', 'mini-bar'] },
  { codigo: 'TABACO', nombre: 'Tabaco', palabras: ['cigarrillo', 'cigarrillos', 'cigarette', 'cigarettes', 'cigarro', 'tabaco', 'tobacco', 'vape'] },
  {
    codigo: 'ENTRETENIMIENTO',
    nombre: 'Películas y entretenimiento',
    palabras: [
      'cine', 'cinema', 'cinemark', 'cinepolis', 'cine colombia', 'procinal', 'pelicula', 'peliculas', 'filme', 'filmes', 'movie', 'movies',
      'pay per view', 'pay-per-view', 'video on demand', 'pelicula en habitacion', 'netflix', 'entretenimiento', 'entertainment', 'entretenimento',
    ],
  },
  {
    codigo: 'SPA',
    nombre: 'Spa y bienestar',
    palabras: ['spa', 'masaje', 'masajes', 'massagem', 'massage', 'sauna', 'bano turco', 'jacuzzi', 'tratamiento facial', 'manicure', 'pedicure'],
  },
];
