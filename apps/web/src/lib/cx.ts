/** Une clases condicionales (sin dependencias). */
export const cx = (...clases: Array<string | false | null | undefined>) => clases.filter(Boolean).join(' ');
