import { ForbiddenException, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  ES_PUBLICO,
  ROLES_REQUERIDOS,
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
    /** Solo modo dev: los roles se leen del directorio (no hay token). */
    private readonly rolesDe: (usuarioId: string) => Promise<string[]>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [ctx.getHandler(), ctx.getClass()])) return true;

    const request = ctx.switchToHttp().getRequest<RequestAutenticado>();
    if (this.modo === 'dev') {
      const usuarioId = request.header('x-usuario-id')?.trim();
      if (!usuarioId) throw new UnauthorizedException('Falta la cabecera x-usuario-id (modo desarrollo)');
      request.usuario = { id: usuarioId, roles: await this.rolesDe(usuarioId) };
    } else {
      const [esquema, token] = request.header('authorization')?.split(' ') ?? [];
      if (esquema?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Falta el token de acceso');
      const claims = await this.tokens.verificar(token);
      request.usuario = { id: claims.usuarioId, roles: claims.roles };
    }

    const requeridos = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_REQUERIDOS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (requeridos?.length && !requeridos.some((r) => request.usuario!.roles.includes(r))) {
      throw new ForbiddenException('No tiene permiso para esta operación');
    }
    return true;
  }
}
