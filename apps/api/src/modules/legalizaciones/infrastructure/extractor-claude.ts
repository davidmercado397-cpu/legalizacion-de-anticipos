import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { ExtractorComprobantes } from '../application/puertos';
import { CATEGORIAS_GASTO, MEDIOS_PAGO, type DatosExtraidos } from '../domain/tipos';

const decimal = z.string().describe('Número decimal con punto, sin separador de miles. Ej: "85000.00"');

/** Esquema que el modelo debe cumplir (salida estructurada validada por el SDK). */
const esquemaExtraccion = z.object({
  tipoDocumento: z.enum(['FACTURA_ELECTRONICA', 'FACTURA', 'TIQUETE_POS', 'RECIBO', 'OTRO']),
  emisorNombre: z.string().nullable(),
  emisorId: z.string().nullable().describe('NIT / CNPJ / Tax ID del vendedor tal como aparece'),
  adquirienteNombre: z.string().nullable(),
  adquirienteId: z.string().nullable().describe('NIT / identificación del comprador, si aparece'),
  numeroDocumento: z.string().nullable(),
  fecha: z.string().nullable().describe('Fecha de emisión en formato YYYY-MM-DD'),
  moneda: z.string().nullable().describe('Código ISO-4217: COP, USD, BRL…'),
  total: decimal.nullable(),
  claveFiscal: z
    .object({ tipo: z.enum(['CUFE', 'CUDE', 'CHAVE_ACESSO_BR']), valor: z.string() })
    .nullable()
    .describe('CUFE/CUDE (96 hex, Colombia) o chave de acesso (44 dígitos, Brasil), si es legible'),
  medioPago: z.enum(MEDIOS_PAGO),
  ultimos4Tarjeta: z.string().nullable().describe('Últimos 4 dígitos si pagó con tarjeta'),
  paisCodigo: z.string().nullable().describe('País de emisión, ISO-3166 alfa-2'),
  categoriaSugerida: z.enum(CATEGORIAS_GASTO),
  lineas: z.array(z.object({ descripcion: z.string(), valor: decimal })),
  propinaSugerida: decimal.nullable().describe('Propina sugerida impresa en la factura, si la hay'),
  confianza: z.enum(['ALTA', 'MEDIA', 'BAJA']),
  observaciones: z.string().nullable(),
});

const INSTRUCCIONES = `Eres un asistente de contabilidad que lee facturas y recibos de gastos de viaje (en español, portugués o inglés).
Extrae los datos del documento adjunto según el esquema.

Reglas:
- No inventes: si un dato no aparece o no es legible, usa null.
- Montos como decimal con punto y sin separadores de miles. En Colombia "85.000" es 85000.00; en Brasil "1.234,56" es 1234.56.
- "total" es el valor final pagado (incluye impuestos y propina si se cobraron).
- "lineas": cada producto o servicio con su valor total por línea. Incluye también, como líneas separadas, los impuestos (IVA, impoconsumo, ICMS…) y la propina o servicio si se cobraron. Si no hay detalle, deja la lista vacía.
- "propinaSugerida": el valor de la propina sugerida o voluntaria que imprime la factura (p. ej. "Propina sugerida 10%: 8.500"); null si no aparece.
- medioPago: TARJETA si hay marca de tarjeta, voucher o últimos dígitos; EFECTIVO si dice efectivo/dinheiro/cash; TRANSFERENCIA para transferencia o PIX; si no se sabe, DESCONOCIDO.
- categoriaSugerida: ALOJAMIENTO (hotel), ALIMENTACION (restaurantes, comidas), VIVERES (supermercado, tiendas), TRANSPORTE (taxi, transporte, combustible, peajes) u OTROS. Usa también la descripción del viajero.
- confianza: BAJA si la imagen está borrosa o incompleta.`;

/**
 * Lectura automática con Claude. Fallos (red, rechazo, respuesta inválida) se
 * propagan: el caso de uso los convierte en "digitación manual".
 */
export class ExtractorClaude implements ExtractorComprobantes {
  readonly automatico = true;
  private readonly cliente: Anthropic;

  constructor(
    apiKey: string,
    private readonly esfuerzo: 'low' | 'medium' | 'high' = 'medium',
    private readonly modelo = 'claude-opus-5-5',
  ) {
    this.cliente = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  }

  async extraer(entrada: { contenido: Buffer; mime: string; descripcionUsuario: string }): Promise<DatosExtraidos | null> {
    const data = entrada.contenido.toString('base64');
    const documento: Anthropic.Beta.BetaContentBlockParam =
      entrada.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: entrada.mime as 'image/jpeg' | 'image/png' | 'image/webp', data } };

    const respuesta = await this.cliente.beta.messages.parse({
      model: this.modelo,
      max_tokens: 16_000,
      // Si el modelo declinara el documento, el API reintenta con otro modelo adecuado.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: INSTRUCCIONES,
      output_config: { effort: this.esfuerzo, format: betaZodOutputFormat(esquemaExtraccion) },
      messages: [
        {
          role: 'user',
          content: [documento, { type: 'text', text: `Descripción del viajero: ${entrada.descripcionUsuario}` }],
        },
      ],
    });

    if (respuesta.stop_reason === 'refusal') throw new Error('La lectura automática fue declinada');
    if (respuesta.stop_reason === 'max_tokens') throw new Error('La respuesta de lectura quedó incompleta');
    const datos = respuesta.parsed_output;
    if (!datos) throw new Error('La respuesta de lectura no cumplió el esquema');
    return datos;
  }
}
