import { SetMetadata, UnauthorizedException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export type ModoAutenticacion = 'dev' | 'jwt';

export type RequestAutenticado = Request & { usuario?: { id: string; roles: string[] } };

export const ES_PUBLICO = 'viaticos:publico';
/** Marca un endpoint como accesible sin autenticación. */
export const Publico = () => SetMetadata(ES_PUBLICO, true);

/** Id del usuario autenticado (lo establece el guard del módulo de identidad). */
export const UsuarioActual = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const usuario = ctx.switchToHttp().getRequest<RequestAutenticado>().usuario;
  if (!usuario) throw new UnauthorizedException('No autenticado');
  return usuario.id;
});
