import { Body, Controller, Get, Inject, Param, Post, Put } from '@nestjs/common';
import {
  cargoSchema,
  empresaRequestSchema,
  usuarioRequestSchema,
  type CargoResponse,
  type EmpresaResponse,
  type UsuarioAdminResponse,
} from '@viaticos/contracts';
import type { z } from 'zod';
import { Roles, UsuarioActual } from '../../../shared/presentation/autenticacion';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { AdministrarOrganizacionUseCase } from '../application/administrar-organizacion.use-case';
import type { Usuario } from '../domain/usuario';

const presentarUsuario = (u: Usuario): UsuarioAdminResponse => ({ ...u, roles: [...u.roles] });

/** Empresas y cargos: contabilidad y administración. Usuarios: solo administración. */
@Controller('administracion')
export class AdministracionController {
  constructor(@Inject(AdministrarOrganizacionUseCase) private readonly admin: AdministrarOrganizacionUseCase) {}

  @Get('empresas')
  @Roles('CONTABILIDAD', 'ADMIN')
  empresas(): Promise<EmpresaResponse[]> {
    return this.admin.listarEmpresas();
  }

  @Post('empresas')
  @Roles('CONTABILIDAD', 'ADMIN')
  crearEmpresa(@Body(new ZodValidationPipe(empresaRequestSchema)) body: z.output<typeof empresaRequestSchema>): Promise<EmpresaResponse> {
    return this.admin.guardarEmpresa(null, body);
  }

  @Put('empresas/:id')
  @Roles('CONTABILIDAD', 'ADMIN')
  editarEmpresa(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(empresaRequestSchema)) body: z.output<typeof empresaRequestSchema>,
  ): Promise<EmpresaResponse> {
    return this.admin.guardarEmpresa(id, body);
  }

  @Get('cargos')
  @Roles('CONTABILIDAD', 'ADMIN')
  cargos(): Promise<CargoResponse[]> {
    return this.admin.listarCargos();
  }

  @Post('cargos')
  @Roles('CONTABILIDAD', 'ADMIN')
  guardarCargo(@Body(new ZodValidationPipe(cargoSchema)) body: z.output<typeof cargoSchema>): Promise<CargoResponse> {
    return this.admin.guardarCargo(body);
  }

  @Get('usuarios')
  @Roles('ADMIN')
  async usuarios(): Promise<UsuarioAdminResponse[]> {
    return (await this.admin.listarUsuarios()).map(presentarUsuario);
  }

  @Post('usuarios')
  @Roles('ADMIN')
  async crearUsuario(
    @UsuarioActual() adminId: string,
    @Body(new ZodValidationPipe(usuarioRequestSchema)) body: z.output<typeof usuarioRequestSchema>,
  ): Promise<UsuarioAdminResponse> {
    return presentarUsuario(await this.admin.guardarUsuario(null, body, adminId));
  }

  @Put('usuarios/:id')
  @Roles('ADMIN')
  async editarUsuario(
    @UsuarioActual() adminId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(usuarioRequestSchema)) body: z.output<typeof usuarioRequestSchema>,
  ): Promise<UsuarioAdminResponse> {
    return presentarUsuario(await this.admin.guardarUsuario(id, body, adminId));
  }
}
