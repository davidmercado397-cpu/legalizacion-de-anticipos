import { UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  ES_PUBLICO,
  type ModoAutenticacion,
  type RequestAutenticado,
} from '../../../shared/presentation/autenticacion';
import type { EmisorTokensAcceso } from '../application/puertos';

/**
 * Guard global que falla cerrado (ADR-0006):
 * - `jwt`: exige `Authorization: Bearer <access token>`.
 * - `dev`: toma el usuario de la cabecera `x-usuario-id` (prohibido en producción).
 */
export class AutenticacionGuard implements CanActivate {
  constructor(
    private readonly modo: ModoAutenticacion,
    private readonly reflector: Reflector,
    private readonly tokens: EmisorTokensAcceso,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [ctx.getHandler(), ctx.getClass()])) return true;

    const request = ctx.switchToHttp().getRequest<RequestAutenticado>();
    if (this.modo === 'dev') {
      const usuarioId = request.header('x-usuario-id')?.trim();
      if (!usuarioId) throw new UnauthorizedException('Falta la cabecera x-usuario-id (modo desarrollo)');
      request.usuario = { id: usuarioId, roles: [] };
      return true;
    }

    const [esquema, token] = request.header('authorization')?.split(' ') ?? [];
    if (esquema?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Falta el token de acceso');
    const claims = await this.tokens.verificar(token);
    request.usuario = { id: claims.usuarioId, roles: claims.roles };
    return true;
  }
}
