import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Api } from '@viaticos/client-api';
import type {
  CargoRequest,
  ConceptoRequest,
  ConfiguracionEscalamientoRequest,
  EmpresaRequest,
  TarifaRequest,
  UsuarioRequest,
} from '@viaticos/contracts';
import { useApi } from '../contexto';

export const clavesAdministracion = {
  todas: ['administracion'] as const,
  escalamiento: () => [...clavesAdministracion.todas, 'escalamiento'] as const,
  empresas: () => [...clavesAdministracion.todas, 'empresas'] as const,
  cargos: () => [...clavesAdministracion.todas, 'cargos'] as const,
  usuarios: () => [...clavesAdministracion.todas, 'usuarios'] as const,
  conceptos: () => [...clavesAdministracion.todas, 'conceptos'] as const,
  tarifas: (filtro: { cargoId?: string; paisCodigo?: string }) => [...clavesAdministracion.todas, 'tarifas', filtro] as const,
};

export const escalamientoOptions = (api: Api) => queryOptions({ queryKey: clavesAdministracion.escalamiento(), queryFn: () => api.administracion.escalamiento() });
export const empresasOptions = (api: Api) => queryOptions({ queryKey: clavesAdministracion.empresas(), queryFn: () => api.administracion.empresas() });
export const cargosOptions = (api: Api) => queryOptions({ queryKey: clavesAdministracion.cargos(), queryFn: () => api.administracion.cargos() });
export const usuariosAdminOptions = (api: Api) => queryOptions({ queryKey: clavesAdministracion.usuarios(), queryFn: () => api.administracion.usuarios() });
export const conceptosOptions = (api: Api) => queryOptions({ queryKey: clavesAdministracion.conceptos(), queryFn: () => api.administracion.conceptos() });
export const tarifasOptions = (api: Api, filtro: { cargoId?: string; paisCodigo?: string } = {}) =>
  queryOptions({ queryKey: clavesAdministracion.tarifas(filtro), queryFn: () => api.administracion.tarifas(filtro) });

/** Mutación que, al terminar, refresca lo que se administró. */
function useMutacionAdmin<V, R>(fn: (api: Api, v: V) => Promise<R>, clave: readonly unknown[]) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: V) => fn(api, v), onSuccess: () => qc.invalidateQueries({ queryKey: clave }) });
}

export const useGuardarEscalamiento = () =>
  useMutacionAdmin((api, datos: ConfiguracionEscalamientoRequest) => api.administracion.guardarEscalamiento(datos), clavesAdministracion.escalamiento());
export const useGuardarEmpresa = () =>
  useMutacionAdmin((api, v: { id: string | null; datos: EmpresaRequest }) => api.administracion.guardarEmpresa(v.id, v.datos), clavesAdministracion.empresas());
export const useGuardarCargo = () => useMutacionAdmin((api, datos: CargoRequest) => api.administracion.guardarCargo(datos), clavesAdministracion.cargos());
export const useGuardarUsuario = () =>
  useMutacionAdmin((api, v: { id: string | null; datos: UsuarioRequest }) => api.administracion.guardarUsuario(v.id, v.datos), clavesAdministracion.usuarios());
export const useAsignarContrasena = () =>
  useMutacionAdmin((api, v: { id: string; contrasena: string }) => api.administracion.asignarContrasena(v.id, v.contrasena), clavesAdministracion.usuarios());
export const useGuardarConcepto = () => useMutacionAdmin((api, datos: ConceptoRequest) => api.administracion.guardarConcepto(datos), clavesAdministracion.conceptos());
export const useCrearTarifa = () => useMutacionAdmin((api, datos: TarifaRequest) => api.administracion.crearTarifa(datos), [...clavesAdministracion.todas, 'tarifas']);
export const useCerrarTarifa = () =>
  useMutacionAdmin((api, v: { id: string; vigenteHasta: string }) => api.administracion.cerrarTarifa(v.id, v.vigenteHasta), [...clavesAdministracion.todas, 'tarifas']);
