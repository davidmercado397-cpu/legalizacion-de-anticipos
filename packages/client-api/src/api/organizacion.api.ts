import type { AxiosInstance } from 'axios';
import type {
  Categoria,
  Compania,
  CompaniaCambios,
  CompaniaNueva,
  ConceptoBloqueado,
  Empleado,
  EmpleadoCambios,
  EmpleadoCreado,
  EmpleadoNuevo,
  Lista,
  Pagina,
  ReglaPolitica,
  ReglaPoliticaNueva,
  ReglasAprobacion,
  ReglasAprobacionNuevas,
  Rol,
} from '@viaticos/contracts';

export interface FiltrosEmpleados {
  search?: string;
  role?: Rol;
  company_id?: string;
  active?: boolean;
  limit?: number;
  offset?: number;
}

export interface OrganizacionApi {
  companias(): Promise<Compania[]>;
  crearCompania(datos: CompaniaNueva): Promise<Compania>;
  actualizarCompania(id: string, cambios: CompaniaCambios): Promise<Compania>;
  categorias(companiaId: string): Promise<Categoria[]>;
  reglas(companiaId: string): Promise<ReglaPolitica[]>;
  configurarReglas(companiaId: string, reglas: ReglaPoliticaNueva[]): Promise<ReglaPolitica[]>;
  conceptosBloqueados(companiaId: string): Promise<ConceptoBloqueado[]>;
  reglasAprobacion(companiaId: string): Promise<ReglasAprobacion>;
  configurarReglasAprobacion(companiaId: string, reglas: ReglasAprobacionNuevas): Promise<ReglasAprobacion>;
  empleados(filtros?: FiltrosEmpleados): Promise<Pagina<Empleado>>;
  empleado(id: string): Promise<Empleado>;
  crearEmpleado(datos: EmpleadoNuevo): Promise<EmpleadoCreado>;
  actualizarEmpleado(id: string, cambios: EmpleadoCambios): Promise<Empleado>;
  activarEmpleado(id: string, activo: boolean): Promise<Empleado>;
  /** Sin contraseña, la API genera una temporal y la devuelve. */
  claveTemporal(id: string, clave?: string): Promise<string>;
  /** Para un celular perdido: el usuario vuelve a activar la verificación al entrar. */
  reiniciarMfa(id: string): Promise<void>;
}

export const crearOrganizacionApi = (http: AxiosInstance): OrganizacionApi => ({
  companias: async () => (await http.get<Lista<Compania>>('/companies')).data.data,
  crearCompania: async (datos) => (await http.post<Compania>('/companies', datos)).data,
  actualizarCompania: async (id, cambios) => (await http.patch<Compania>(`/companies/${id}`, cambios)).data,
  categorias: async (companiaId) => (await http.get<Lista<Categoria>>(`/companies/${companiaId}/categories`)).data.data,
  reglas: async (companiaId) => (await http.get<Lista<ReglaPolitica>>(`/companies/${companiaId}/policy-rules`)).data.data,
  configurarReglas: async (companiaId, reglas) =>
    (await http.put<Lista<ReglaPolitica>>(`/companies/${companiaId}/policy-rules`, reglas)).data.data,
  conceptosBloqueados: async (companiaId) =>
    (await http.get<Lista<ConceptoBloqueado>>(`/companies/${companiaId}/blocked-concepts`)).data.data,
  reglasAprobacion: async (companiaId) => (await http.get<ReglasAprobacion>(`/companies/${companiaId}/approval-rules`)).data,
  configurarReglasAprobacion: async (companiaId, reglas) =>
    (await http.put<ReglasAprobacion>(`/companies/${companiaId}/approval-rules`, reglas)).data,
  empleados: async (filtros = {}) => (await http.get<Pagina<Empleado>>('/employees', { params: filtros })).data,
  empleado: async (id) => (await http.get<Empleado>(`/employees/${id}`)).data,
  crearEmpleado: async (datos) => (await http.post<EmpleadoCreado>('/employees', datos)).data,
  actualizarEmpleado: async (id, cambios) => (await http.patch<Empleado>(`/employees/${id}`, cambios)).data,
  activarEmpleado: async (id, activo) => (await http.post<Empleado>(`/employees/${id}/${activo ? 'activate' : 'deactivate'}`)).data,
  claveTemporal: async (id, clave) =>
    (await http.post<{ temporary_password: string }>(`/employees/${id}/password`, { password: clave ?? null })).data.temporary_password,
  reiniciarMfa: async (id) => {
    await http.post(`/employees/${id}/mfa/reset`);
  },
});
