import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import {
  cargoSchema,
  conceptoSchema,
  configuracionEscalamientoResponseSchema,
  empresaResponseSchema,
  tarifaResponseSchema,
  usuarioAdminResponseSchema,
  type CargoRequest,
  type CargoResponse,
  type ConceptoRequest,
  type ConceptoResponse,
  type ConfiguracionEscalamientoRequest,
  type ConfiguracionEscalamientoResponse,
  type EmpresaRequest,
  type EmpresaResponse,
  type TarifaRequest,
  type TarifaResponse,
  type UsuarioAdminResponse,
  type UsuarioRequest,
} from '@viaticos/contracts';

export interface AdministracionApi {
  escalamiento(): Promise<ConfiguracionEscalamientoResponse>;
  guardarEscalamiento(datos: ConfiguracionEscalamientoRequest): Promise<ConfiguracionEscalamientoResponse>;
  empresas(): Promise<EmpresaResponse[]>;
  guardarEmpresa(id: string | null, datos: EmpresaRequest): Promise<EmpresaResponse>;
  cargos(): Promise<CargoResponse[]>;
  guardarCargo(datos: CargoRequest): Promise<CargoResponse>;
  usuarios(): Promise<UsuarioAdminResponse[]>;
  guardarUsuario(id: string | null, datos: UsuarioRequest): Promise<UsuarioAdminResponse>;
  asignarContrasena(id: string, contrasena: string): Promise<void>;
  conceptos(): Promise<ConceptoResponse[]>;
  guardarConcepto(datos: ConceptoRequest): Promise<ConceptoResponse>;
  tarifas(filtro?: { cargoId?: string; paisCodigo?: string }): Promise<TarifaResponse[]>;
  crearTarifa(datos: TarifaRequest): Promise<TarifaResponse>;
  cerrarTarifa(id: string, vigenteHasta: string): Promise<TarifaResponse>;
}

const a = '/administracion';
const id = (v: string) => encodeURIComponent(v);
const cargoRespuesta = cargoSchema.required();
const conceptoRespuesta = conceptoSchema.required();

export const crearAdministracionApi = (http: AxiosInstance): AdministracionApi => ({
  escalamiento: async () => configuracionEscalamientoResponseSchema.parse((await http.get('/configuracion-escalamiento')).data),
  guardarEscalamiento: async (datos) => configuracionEscalamientoResponseSchema.parse((await http.put('/configuracion-escalamiento', datos)).data),
  empresas: async () => z.array(empresaResponseSchema).parse((await http.get(`${a}/empresas`)).data),
  guardarEmpresa: async (empresaId, datos) =>
    empresaResponseSchema.parse((await (empresaId ? http.put(`${a}/empresas/${id(empresaId)}`, datos) : http.post(`${a}/empresas`, datos))).data),
  cargos: async () => z.array(cargoRespuesta).parse((await http.get(`${a}/cargos`)).data),
  guardarCargo: async (datos) => cargoRespuesta.parse((await http.post(`${a}/cargos`, datos)).data),
  usuarios: async () => z.array(usuarioAdminResponseSchema).parse((await http.get(`${a}/usuarios`)).data),
  guardarUsuario: async (usuarioId, datos) =>
    usuarioAdminResponseSchema.parse((await (usuarioId ? http.put(`${a}/usuarios/${id(usuarioId)}`, datos) : http.post(`${a}/usuarios`, datos))).data),
  asignarContrasena: async (usuarioId, contrasena) => {
    await http.put(`${a}/usuarios/${id(usuarioId)}/contrasena`, { contrasena });
  },
  conceptos: async () => z.array(conceptoRespuesta).parse((await http.get(`${a}/conceptos`)).data),
  guardarConcepto: async (datos) => conceptoRespuesta.parse((await http.post(`${a}/conceptos`, datos)).data),
  tarifas: async (filtro = {}) => z.array(tarifaResponseSchema).parse((await http.get(`${a}/tarifas`, { params: filtro })).data),
  crearTarifa: async (datos) => tarifaResponseSchema.parse((await http.post(`${a}/tarifas`, datos)).data),
  cerrarTarifa: async (tarifaId, vigenteHasta) => tarifaResponseSchema.parse((await http.post(`${a}/tarifas/${id(tarifaId)}/cierre`, { vigenteHasta })).data),
});
