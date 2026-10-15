import { DomainError } from '@viaticos/shared-kernel';

/**
 * Identificador fiscal único de un documento electrónico:
 * - CUFE/CUDE (Colombia, DIAN): SHA-384 en hexadecimal (96 caracteres).
 * - Chave de acesso (Brasil, NF-e/NFC-e): 44 dígitos con dígito verificador módulo 11.
 */
export type TipoClaveFiscal = 'CUFE' | 'CUDE' | 'CHAVE_ACESSO_BR';

export class ClaveFiscal {
  private constructor(
    readonly tipo: TipoClaveFiscal,
    readonly valor: string,
  ) {}

  static crear(tipo: TipoClaveFiscal, valorCrudo: string): ClaveFiscal {
    if (tipo === 'CHAVE_ACESSO_BR') {
      const digitos = valorCrudo.replace(/\D/g, '');
      if (digitos.length !== 44 || calcularDvChaveAcesso(digitos.slice(0, 43)) !== Number(digitos[43])) {
        throw ClaveFiscal.invalida(tipo);
      }
      return new ClaveFiscal(tipo, digitos);
    }
    const hex = valorCrudo.replace(/\s/g, '').toLowerCase();
    if (!/^[0-9a-f]{96}$/.test(hex)) throw ClaveFiscal.invalida(tipo);
    return new ClaveFiscal(tipo, hex);
  }

  equals(otra: ClaveFiscal): boolean {
    return this.valor === otra.valor;
  }

  private static invalida(tipo: TipoClaveFiscal): DomainError {
    return new DomainError('CLAVE_FISCAL_INVALIDA', 'VALIDACION', `${tipo} con formato o dígito verificador inválido`, {
      tipo,
    });
  }
}

/** Dígito verificador de la chave de acesso: pesos 2..9 de derecha a izquierda, módulo 11. */
export function calcularDvChaveAcesso(base43: string): number {
  let suma = 0;
  let peso = 2;
  for (let i = base43.length - 1; i >= 0; i--) {
    suma += Number(base43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = suma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
