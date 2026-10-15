import { z } from 'zod';

const esquema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    AUTH_MODE: z.enum(['dev', 'jwt']).default('jwt'),
    TRM_DESARROLLO: z.string().regex(/^\d+(\.\d+)?$/).default('4000'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
  })
  .refine((c) => !(c.NODE_ENV === 'production' && c.AUTH_MODE === 'dev'), {
    error: 'AUTH_MODE=dev está prohibido con NODE_ENV=production',
    path: ['AUTH_MODE'],
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
