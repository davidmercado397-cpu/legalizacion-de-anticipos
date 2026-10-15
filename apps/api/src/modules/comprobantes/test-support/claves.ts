import { calcularDvChaveAcesso } from '../domain/clave-fiscal';

export const BASE_CHAVE = '3526100123456700019055001000000123100000001'; // 43 dígitos
export const CHAVE_VALIDA = BASE_CHAVE + calcularDvChaveAcesso(BASE_CHAVE);
export const CUFE = 'a'.repeat(48) + '0123456789abcdef'.repeat(3);
