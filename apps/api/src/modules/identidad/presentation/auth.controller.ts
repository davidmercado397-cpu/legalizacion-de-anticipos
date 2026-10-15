import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  loginRequestSchema,
  refrescarRequestSchema,
  type SesionResponse,
  type UsuarioSesion,
} from '@viaticos/contracts';
import { DomainError } from '@viaticos/shared-kernel';
import type { Request, Response } from 'express';
import type { Configuracion } from '../../../shared/configuracion';
import { Publico, UsuarioActual } from '../../../shared/presentation/autenticacion';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { CONFIGURACION } from '../../../shared/tokens';
import { GestorSesiones, type SesionEmitida } from '../application/sesiones.use-cases';

export const COOKIE_REFRESH = 'viaticos_rt';
const RUTA_COOKIE = '/api/v1/auth';

const esMovil = (req: Request) => req.header('x-cliente') === 'movil';

function leerCookie(req: Request, nombre: string): string | undefined {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const [clave, ...valor] = parte.trim().split('=');
    if (clave === nombre) return decodeURIComponent(valor.join('='));
  }
  return undefined;
}

/**
 * La web recibe el refresh token en una cookie httpOnly (no accesible desde JS).
 * La app móvil lo recibe en el cuerpo y lo guarda en el almacenamiento seguro del dispositivo.
 */
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(GestorSesiones) private readonly sesiones: GestorSesiones,
    @Inject(CONFIGURACION) private readonly config: Configuracion,
  ) {}

  @Post('login')
  @Publico()
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: { email: string; contrasena: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SesionResponse> {
    return this.responder(await this.sesiones.iniciar(body.email, body.contrasena), req, res);
  }

  @Post('refresh')
  @Publico()
  @HttpCode(200)
  async refrescar(
    @Body(new ZodValidationPipe(refrescarRequestSchema)) body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SesionResponse> {
    const token = body.refreshToken ?? leerCookie(req, COOKIE_REFRESH);
    if (!token) throw new DomainError('SESION_INVALIDA', 'NO_AUTENTICADO', 'No hay sesión activa');
    try {
      return this.responder(await this.sesiones.refrescar(token), req, res);
    } catch (error) {
      res.clearCookie(COOKIE_REFRESH, { path: RUTA_COOKIE });
      throw error;
    }
  }

  @Post('logout')
  @Publico()
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(refrescarRequestSchema)) body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = body.refreshToken ?? leerCookie(req, COOKIE_REFRESH);
    if (token) await this.sesiones.cerrar(token);
    res.clearCookie(COOKIE_REFRESH, { path: RUTA_COOKIE });
  }

  @Get('me')
  async perfil(@UsuarioActual() usuarioId: string): Promise<UsuarioSesion> {
    return this.aUsuarioSesion(await this.sesiones.perfil(usuarioId));
  }

  private responder(sesion: SesionEmitida, req: Request, res: Response): SesionResponse {
    const respuesta: SesionResponse = {
      accessToken: sesion.accessToken,
      expiraEn: sesion.expiraEn.toISOString(),
      usuario: this.aUsuarioSesion(sesion.usuario),
    };
    if (esMovil(req)) return { ...respuesta, refreshToken: sesion.refreshToken };

    res.cookie(COOKIE_REFRESH, sesion.refreshToken, {
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: RUTA_COOKIE,
      expires: sesion.refreshExpiraEn,
    });
    return respuesta;
  }

  private aUsuarioSesion(u: SesionEmitida['usuario']): UsuarioSesion {
    return { id: u.id, nombre: u.nombre, email: u.email, roles: u.roles as UsuarioSesion['roles'] };
  }
}
