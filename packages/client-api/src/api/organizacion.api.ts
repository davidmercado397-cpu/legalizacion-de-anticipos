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
  CodigoWhatsApp,
  Rol,
  Suplencia,
  SuplenciaNueva,
  Tarifa,
  TarifaNueva,
  ZonaViaje,
  ZonaViajeCambios,
  ZonaViajeNueva,
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
  suplencias(empleadoId: string): Promise<Suplencia[]>;
  crearSuplencia(empleadoId: string, datos: SuplenciaNueva): Promise<Suplencia>;
  revocarSuplencia(empleadoId: string, suplenciaId: string): Promise<void>;
  /** Reenvía la plantilla de bienvenida de WhatsApp (el usuario confirma que es él). */
  bienvenidaWhatsApp(empleadoId: string): Promise<void>;
  /** Código para que el usuario escriba «VINCULAR <código>» al número de WhatsApp. */
  codigoWhatsApp(empleadoId: string): Promise<CodigoWhatsApp>;
  desvincularWhatsApp(empleadoId: string): Promise<void>;
  /** Habeas data de un retirado: borra celular e identidad de WhatsApp; los gastos se conservan. */
  borrarContacto(empleadoId: string): Promise<Empleado>;
  zonas(companiaId: string): Promise<ZonaViaje[]>;
  crearZona(companiaId: string, datos: ZonaViajeNueva): Promise<ZonaViaje>;
  actualizarZona(companiaId: string, zonaId: string, cambios: ZonaViajeCambios): Promise<ZonaViaje>;
  tarifas(companiaId: string): Promise<Tarifa[]>;
  crearTarifa(companiaId: string, datos: TarifaNueva): Promise<Tarifa>;
  desactivarTarifa(companiaId: string, tarifaId: string): Promise<void>;
  /** Todo o nada: si una fila tiene problemas, la API responde 422 con el detalle por fila. */
  importarTarifas(companiaId: string, archivo: Blob, nombre: string): Promise<number>;
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
  suplencias: async (empleadoId) => (await http.get<Lista<Suplencia>>(`/employees/${empleadoId}/delegations`)).data.data,
  crearSuplencia: async (empleadoId, datos) => (await http.post<Suplencia>(`/employees/${empleadoId}/delegations`, datos)).data,
  revocarSuplencia: async (empleadoId, suplenciaId) => {
    await http.delete(`/employees/${empleadoId}/delegations/${suplenciaId}`);
  },
  bienvenidaWhatsApp: async (empleadoId) => {
    await http.post(`/employees/${empleadoId}/whatsapp-welcome`);
  },
  codigoWhatsApp: async (empleadoId) => (await http.post<CodigoWhatsApp>(`/employees/${empleadoId}/whatsapp-link-code`)).data,
  desvincularWhatsApp: async (empleadoId) => {
    await http.delete(`/employees/${empleadoId}/whatsapp-link`);
  },
  borrarContacto: async (empleadoId) => (await http.post<Empleado>(`/employees/${empleadoId}/anonymize-contact`)).data,
  zonas: async (companiaId) => (await http.get<Lista<ZonaViaje>>(`/companies/${companiaId}/travel-zones`)).data.data,
  crearZona: async (companiaId, datos) => (await http.post<ZonaViaje>(`/companies/${companiaId}/travel-zones`, datos)).data,
  actualizarZona: async (companiaId, zonaId, cambios) =>
    (await http.patch<ZonaViaje>(`/companies/${companiaId}/travel-zones/${zonaId}`, cambios)).data,
  tarifas: async (companiaId) => (await http.get<Lista<Tarifa>>(`/companies/${companiaId}/travel-rates`)).data.data,
  crearTarifa: async (companiaId, datos) => (await http.post<Tarifa>(`/companies/${companiaId}/travel-rates`, datos)).data,
  desactivarTarifa: async (companiaId, tarifaId) => {
    await http.delete(`/companies/${companiaId}/travel-rates/${tarifaId}`);
  },
  importarTarifas: async (companiaId, archivo, nombre) => {
    const datos = new FormData();
    datos.append('file', archivo, nombre);
    return (await http.post<{ imported: number }>(`/companies/${companiaId}/travel-rates/import`, datos)).data.imported;
  },
});
