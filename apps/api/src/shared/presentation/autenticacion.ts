import { SetMetadata, UnauthorizedException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export type ModoAutenticacion = 'dev' | 'jwt';

export type RequestAutenticado = Request & { usuario?: { id: string; roles: string[] } };

export const ES_PUBLICO = 'viaticos:publico';
export const ROLES_REQUERIDOS = 'viaticos:roles';

/** Exige al menos uno de los roles indicados (403 si no lo tiene). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_REQUERIDOS, roles);
/** Marca un endpoint como accesible sin autenticación. */
export const Publico = () => SetMetadata(ES_PUBLICO, true);

/** Roles del usuario autenticado. */
export const RolesUsuario = createParamDecorator((_: unknown, ctx: ExecutionContext): string[] => {
  return ctx.switchToHttp().getRequest<RequestAutenticado>().usuario?.roles ?? [];
});

/** Id del usuario autenticado (lo establece el guard del módulo de identidad). */
export const UsuarioActual = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const usuario = ctx.switchToHttp().getRequest<RequestAutenticado>().usuario;
  if (!usuario) throw new UnauthorizedException('No autenticado');
  return usuario.id;
});
