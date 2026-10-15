import { z } from 'zod';

export const paisesConTarifaResponseSchema = z.object({
  paises: z.array(z.string().length(2)),
});
export type PaisesConTarifaResponse = z.infer<typeof paisesConTarifaResponseSchema>;
