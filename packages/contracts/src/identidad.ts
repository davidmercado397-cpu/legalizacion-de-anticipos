import { z } from 'zod';

export const ROLES = ['VIAJERO', 'APROBADOR', 'GERENCIA', 'TESORERIA', 'CONTABILIDAD', 'ADMIN'] as const;
export const rolSchema = z.enum(ROLES);
export type Rol = z.infer<typeof rolSchema>;

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email({ error: 'validation.email' }),
  contrasena: z.string().min(1, { error: 'validation.required' }).max(200),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const refrescarRequestSchema = z.object({
  /** Solo clientes móviles; la web usa una cookie httpOnly. */
  refreshToken: z.string().min(20).optional(),
});

export const usuarioSesionSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  email: z.string(),
  roles: z.array(rolSchema),
});
export type UsuarioSesion = z.infer<typeof usuarioSesionSchema>;

export const sesionResponseSchema = z.object({
  accessToken: z.string(),
  /** ISO-8601: cuándo vence el access token. */
  expiraEn: z.string(),
  usuario: usuarioSesionSchema,
  /** Solo se envía a clientes móviles (cabecera `x-cliente: movil`). */
  refreshToken: z.string().optional(),
});
export type SesionResponse = z.infer<typeof sesionResponseSchema>;
