import type { AxiosInstance } from 'axios';
import type {
  Anticipo,
  AnticipoDetalle,
  AnticipoResumen,
  Desembolso,
  Devolucion,
  EstadoAnticipo,
  EventoLinea,
  Liquidacion,
  Lista,
  Pagina,
  Presupuesto,
  SaldoAbierto,
  SolicitudAnticipo,
  SugerenciaDevolucion,
  Viaje,
} from '@viaticos/contracts';

export interface FiltrosAnticipos {
  status?: EstadoAnticipo;
  disbursed?: boolean;
  /** Solo los que tienen una diferencia por liquidar. */
  settlement?: 'pending';
  limit?: number;
  offset?: number;
}

export interface AnticiposApi {
  saldosAbiertos(): Promise<SaldoAbierto[]>;
  listar(filtros?: FiltrosAnticipos): Promise<Pagina<AnticipoResumen>>;
  /** Las solicitudes en las que le toca decidir ahora (su paso de la ruta o el nivel superior). */
  pendientesDeAprobar(): Promise<AnticipoResumen[]>;
  obtener(id: string): Promise<AnticipoDetalle>;
  lineaDeTiempo(id: string): Promise<EventoLinea[]>;
  presupuesto(viaje: Viaje): Promise<Presupuesto>;
  solicitar(datos: SolicitudAnticipo): Promise<Anticipo>;
  aprobar(id: string): Promise<Anticipo>;
  rechazar(id: string, nota: string | null): Promise<Anticipo>;
  cancelar(id: string): Promise<Anticipo>;
  anular(id: string, nota: string): Promise<Anticipo>;
  enviar(id: string): Promise<Anticipo>;
  cerrar(id: string): Promise<Anticipo>;
  devolver(id: string, datos: Devolucion): Promise<Anticipo>;
  sugerenciasDevolucion(id: string): Promise<SugerenciaDevolucion[]>;
  reabrir(id: string, nota: string): Promise<Anticipo>;
  desembolsar(id: string, datos: Desembolso): Promise<Anticipo>;
  liquidar(id: string, datos: Liquidacion): Promise<Anticipo>;
  excel(id: string): Promise<{ archivo: Blob; nombre: string }>;
}

const nombreArchivo = (disposicion: unknown, porDefecto: string) =>
  /filename="([^"]+)"/.exec(String(disposicion ?? ''))?.[1] ?? porDefecto;

export const crearAnticiposApi = (http: AxiosInstance): AnticiposApi => {
  const accion = async (id: string, ruta: string, cuerpo: unknown = {}) => (await http.post<Anticipo>(`/advances/${id}/${ruta}`, cuerpo)).data;
  return {
    saldosAbiertos: async () => (await http.get<Lista<SaldoAbierto>>('/me/balances')).data.data,
    listar: async (filtros = {}) => (await http.get<Pagina<AnticipoResumen>>('/advances', { params: filtros })).data,
    pendientesDeAprobar: async () => (await http.get<Lista<AnticipoResumen>>('/advances/pending-approval')).data.data,
    obtener: async (id) => (await http.get<AnticipoDetalle>(`/advances/${id}`)).data,
    lineaDeTiempo: async (id) => (await http.get<Lista<EventoLinea>>(`/advances/${id}/timeline`)).data.data,
    presupuesto: async (viaje) => (await http.post<Presupuesto>('/advances/budget-preview', viaje)).data,
    solicitar: async (datos) => (await http.post<Anticipo>('/advances', datos)).data,
    aprobar: (id) => accion(id, 'approve'),
    rechazar: (id, nota) => accion(id, 'reject', { note: nota }),
    cancelar: async (id) => (await http.delete<Anticipo>(`/advances/${id}`)).data,
    anular: (id, nota) => accion(id, 'void', { note: nota }),
    enviar: (id) => accion(id, 'submit'),
    cerrar: (id) => accion(id, 'close'),
    devolver: (id, datos) => accion(id, 'return', datos),
    sugerenciasDevolucion: async (id) =>
      (await http.get<Lista<SugerenciaDevolucion>>(`/advances/${id}/return-suggestions`)).data.data,
    reabrir: (id, nota) => accion(id, 'reopen', { note: nota }),
    desembolsar: (id, datos) => accion(id, 'disburse', datos),
    liquidar: (id, datos) => accion(id, 'settle', datos),
    excel: async (id) => {
      const respuesta = await http.get<Blob>(`/advances/${id}/legalization.xlsx`, { responseType: 'blob' });
      return { archivo: respuesta.data, nombre: nombreArchivo(respuesta.headers['content-disposition'], 'legalizacion.xlsx') };
    },
  };
};
