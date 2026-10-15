import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { DomainError } from '@viaticos/shared-kernel';
import { SignJWT, errors, jwtVerify } from 'jose';
import type { ClaimsAcceso, EmisorTokensAcceso, HasherContrasenas, TokensOpacos } from '../application/puertos';

/** argon2id con los parámetros mínimos recomendados por OWASP (19 MiB, t=2, p=1). */
export class HasherArgon2 implements HasherContrasenas {
  hash(contrasena: string): Promise<string> {
    return hash(contrasena, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }

  async verificar(hashGuardado: string, contrasena: string): Promise<boolean> {
    try {
      return await verify(hashGuardado, contrasena);
    } catch {
      return false;
    }
  }
}

const EMISOR = 'viaticos-api';
const AUDIENCIA = 'viaticos';

export class EmisorTokensJose implements EmisorTokensAcceso {
  private readonly clave: Uint8Array;

  constructor(
    secreto: string,
    private readonly ttlSegundos: number,
    private readonly ahora: () => Date = () => new Date(),
  ) {
    this.clave = new TextEncoder().encode(secreto);
  }

  async emitir(claims: ClaimsAcceso): Promise<{ token: string; expiraEn: Date }> {
    const emitidoEn = Math.floor(this.ahora().getTime() / 1000);
    const expira = emitidoEn + this.ttlSegundos;
    const token = await new SignJWT({ roles: claims.roles })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.usuarioId)
      .setIssuer(EMISOR)
      .setAudience(AUDIENCIA)
      .setIssuedAt(emitidoEn)
      .setExpirationTime(expira)
      .sign(this.clave);
    return { token, expiraEn: new Date(expira * 1000) };
  }

  async verificar(token: string): Promise<ClaimsAcceso> {
    try {
      const { payload } = await jwtVerify(token, this.clave, {
        issuer: EMISOR,
        audience: AUDIENCIA,
        algorithms: ['HS256'],
        currentDate: this.ahora(),
      });
      const roles = Array.isArray(payload.roles) ? payload.roles.filter((r) => typeof r === 'string') : [];
      if (!payload.sub) throw new Error('sin sub');
      return { usuarioId: payload.sub, roles };
    } catch (error) {
      const vencido = error instanceof errors.JWTExpired;
      throw new DomainError(
        vencido ? 'TOKEN_VENCIDO' : 'TOKEN_INVALIDO',
        'NO_AUTENTICADO',
        vencido ? 'El token de acceso venció' : 'Token de acceso inválido',
      );
    }
  }
}

export class TokensOpacosCrypto implements TokensOpacos {
  generar(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
