import {
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export type ModoAutenticacion = 'dev' | 'jwt';

type RequestAutenticado = Request & { usuarioId?: string };

const ES_PUBLICO = 'viaticos:publico';
export const Publico = () => SetMetadata(ES_PUBLICO, true);

export const UsuarioActual = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const usuarioId = ctx.switchToHttp().getRequest<RequestAutenticado>().usuarioId;
  if (!usuarioId) throw new UnauthorizedException('No autenticado');
  return usuarioId;
});

/**
 * Guard global que falla cerrado (ADR-0006):
 * - `dev`: toma el usuario de la cabecera `x-usuario-id` (prohibido en producción).
 * - `jwt`: pendiente para la iteración 2; mientras tanto rechaza todo.
 */
export class AutenticacionGuard implements CanActivate {
  constructor(
    private readonly modo: ModoAutenticacion,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [ctx.getHandler(), ctx.getClass()]);
    if (publico) return true;

    const request = ctx.switchToHttp().getRequest<RequestAutenticado>();
    if (this.modo === 'dev') {
      const usuarioId = request.header('x-usuario-id')?.trim();
      if (!usuarioId) throw new UnauthorizedException('Falta la cabecera x-usuario-id (modo desarrollo)');
      request.usuarioId = usuarioId;
      return true;
    }
    throw new UnauthorizedException('Autenticación JWT aún no implementada');
  }
}
