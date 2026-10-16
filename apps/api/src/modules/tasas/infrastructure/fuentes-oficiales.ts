import type { FechaCalendario } from '@viaticos/shared-kernel';
import type { CotizacionDolar, FuenteTasas } from '../application/puertos';

type Fetch = typeof fetch;
const TIEMPO_MAXIMO_MS = 10_000;

async function obtenerJson(fetchImpl: Fetch, url: string): Promise<unknown> {
  const respuesta = await fetchImpl(url, { signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS), headers: { accept: 'application/json' } });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} en ${new URL(url).host}`);
  return respuesta.json();
}

/**
 * TRM (Superintendencia Financiera) publicada en datos.gov.co, dataset 32sa-8pi3.
 * Cada registro tiene una vigencia (vigenciadesde/vigenciahasta) que cubre fines de semana y festivos.
 */
export class FuenteTrmDatosGov implements FuenteTasas {
  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly base = 'https://www.datos.gov.co/resource/32sa-8pi3.json',
  ) {}

  soporta(moneda: string): boolean {
    return moneda === 'COP';
  }

  async cotizar(moneda: string, fecha: FechaCalendario): Promise<CotizacionDolar | null> {
    const dia = `${fecha.toString()}T00:00:00`;
    // La TRM vigente en la fecha; si aún no existe (hoy temprano), la última publicada antes.
    const consulta = new URLSearchParams({
      $where: `vigenciadesde <= '${dia}'`,
      $order: 'vigenciadesde DESC',
      $limit: '1',
    });
    const filas = (await obtenerJson(this.fetchImpl, `${this.base}?${consulta}`)) as Array<{ valor?: string; vigenciadesde?: string }>;
    const fila = filas[0];
    if (!fila?.valor || !fila.vigenciadesde || !/^\d+(\.\d+)?$/.test(fila.valor)) return null;
    return {
      moneda,
      fecha: fecha.toString(),
      porDolar: fila.valor,
      fechaPublicada: fila.vigenciadesde.slice(0, 10),
      fuente: 'TRM',
    };
  }
}

/** Monedas que publica el Banco Central Europeo (además de USD). */
const MONEDAS_BCE = new Set(
  'AUD BGN BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY ZAR'.split(' '),
);

/** Banco Central Europeo vía Frankfurter: devuelve el día hábil anterior más cercano si la fecha no tiene dato. */
export class FuenteBceFrankfurter implements FuenteTasas {
  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly base = 'https://api.frankfurter.dev/v1',
  ) {}

  soporta(moneda: string): boolean {
    return MONEDAS_BCE.has(moneda);
  }

  async cotizar(moneda: string, fecha: FechaCalendario): Promise<CotizacionDolar | null> {
    const datos = (await obtenerJson(this.fetchImpl, `${this.base}/${fecha.toString()}?base=USD&symbols=${moneda}`)) as {
      date?: string;
      rates?: Record<string, number>;
    };
    const valor = datos.rates?.[moneda];
    if (valor === undefined || !datos.date || !(valor > 0)) return null;
    return { moneda, fecha: fecha.toString(), porDolar: String(valor), fechaPublicada: datos.date, fuente: 'BCE' };
  }
}

/**
 * Respaldo para monedas sin fuente oficial automática (PEN, CLP, ARS…): tasas por
 * dólar configuradas (TASAS_RESPALDO). Quedan marcadas como "CONFIGURADA" para auditoría.
 */
export class FuenteTasasConfiguradas implements FuenteTasas {
  private readonly porDolar = new Map<string, string>();

  constructor(tasasPorDolar: string) {
    for (const par of tasasPorDolar.split(',').map((p) => p.trim()).filter(Boolean)) {
      const [moneda, valor] = par.split('=').map((v) => v?.trim());
      if (moneda && valor && /^\d+(\.\d+)?$/.test(valor)) this.porDolar.set(moneda.toUpperCase(), valor);
    }
  }

  soporta(moneda: string): boolean {
    return this.porDolar.has(moneda);
  }

  async cotizar(moneda: string, fecha: FechaCalendario): Promise<CotizacionDolar | null> {
    const valor = this.porDolar.get(moneda);
    return valor ? { moneda, fecha: fecha.toString(), porDolar: valor, fechaPublicada: fecha.toString(), fuente: 'CONFIGURADA' } : null;
  }
}
