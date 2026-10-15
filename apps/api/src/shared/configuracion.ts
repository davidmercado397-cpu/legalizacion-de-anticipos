import { z } from 'zod';

const esquema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    PERSISTENCIA: z.enum(['memoria', 'postgres']).default('postgres'),
    DATABASE_URL: z.string().url().optional(),
    AUTH_MODE: z.enum(['dev', 'jwt']).default('jwt'),
    JWT_SECRET: z.string().optional(),
    /** Vida del access token (segundos) y del refresh token (días). */
    JWT_ACCESS_TTL_SEGUNDOS: z.coerce.number().int().positive().default(900),
    REFRESH_TTL_DIAS: z.coerce.number().int().positive().default(7),
    TRM_DESARROLLO: z.string().regex(/^\d+(\.\d+)?$/).default('4000'),
    /** Tasas de desarrollo por dólar, además de la TRM (COP). */
    TASAS_DESARROLLO: z.string().default('BRL=5.40,EUR=0.92,MXN=18.50,PEN=3.75,CLP=950'),
    /** Carpeta de archivos de soportes (en Docker es un volumen). */
    ALMACEN_DIR: z.string().default('./almacen'),
    /** manual: el viajero digita los datos · claude: lectura automática con Claude (requiere ANTHROPIC_API_KEY). */
    OCR_PROVEEDOR: z.enum(['manual', 'claude']).default('manual'),
    ANTHROPIC_API_KEY: z.string().optional(),
    OCR_ESFUERZO: z.enum(['low', 'medium', 'high']).default('medium'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
  })
  .refine((c) => !(c.NODE_ENV === 'production' && c.AUTH_MODE === 'dev'), {
    error: 'AUTH_MODE=dev está prohibido con NODE_ENV=production',
    path: ['AUTH_MODE'],
  })
  .refine((c) => !(c.NODE_ENV === 'production' && c.PERSISTENCIA === 'memoria'), {
    error: 'PERSISTENCIA=memoria está prohibido con NODE_ENV=production (se perderían los datos)',
    path: ['PERSISTENCIA'],
  })
  .refine((c) => c.PERSISTENCIA !== 'postgres' || !!c.DATABASE_URL, {
    error: 'DATABASE_URL es obligatorio con PERSISTENCIA=postgres',
    path: ['DATABASE_URL'],
  })
  .refine((c) => c.OCR_PROVEEDOR !== 'claude' || !!c.ANTHROPIC_API_KEY, {
    error: 'OCR_PROVEEDOR=claude requiere ANTHROPIC_API_KEY',
    path: ['ANTHROPIC_API_KEY'],
  })
  .refine((c) => c.AUTH_MODE !== 'jwt' || (c.JWT_SECRET?.length ?? 0) >= 32, {
    error: 'JWT_SECRET debe tener al menos 32 caracteres con AUTH_MODE=jwt',
    path: ['JWT_SECRET'],
  });

export type Configuracion = z.output<typeof esquema>;

/** Valida las variables de entorno al arrancar: si algo falta o es inseguro, la app no inicia. */
export function cargarConfiguracion(env: Record<string, string | undefined> = process.env): Configuracion {
  const resultado = esquema.safeParse(env);
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${detalle}`);
  }
  return resultado.data;
}
