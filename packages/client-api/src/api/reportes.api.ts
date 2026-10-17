import type { AxiosInstance } from 'axios';
import type {
  CumplimientoPresupuesto,
  FacturaOtraCompania,
  GastoPorConcepto,
  Lista,
  PrecisionIa,
  SaldoPendiente,
  UsoMes,
} from '@viaticos/contracts';

/** Periodo en fechas de calendario (YYYY-MM-DD) y, si se elige, una sola compañía. */
export interface Periodo {
  start: string;
  end: string;
  company_id?: string;
}

export type Reporte = 'pending-balances' | 'spend' | 'budget-compliance' | 'intercompany-invoices';

export interface ReportesApi {
  saldosPendientes(companiaId?: string): Promise<SaldoPendiente[]>;
  gasto(periodo: Periodo): Promise<GastoPorConcepto[]>;
  cumplimiento(periodo: Periodo): Promise<CumplimientoPresupuesto[]>;
  otraCompania(periodo: Periodo): Promise<FacturaOtraCompania[]>;
  precisionIa(companiaId: string, mes: string): Promise<PrecisionIa>;
  uso(mes: string): Promise<UsoMes>;
  /** El mismo reporte en Excel, con el nombre que propone la API. */
  excel(reporte: Reporte, parametros: Partial<Periodo>): Promise<{ archivo: Blob; nombre: string }>;
}

const nombreArchivo = (disposicion: unknown, porDefecto: string) =>
  /filename="([^"]+)"/.exec(String(disposicion ?? ''))?.[1] ?? porDefecto;

export const crearReportesApi = (http: AxiosInstance): ReportesApi => {
  const lista = async <T>(ruta: string, params: object) => (await http.get<Lista<T>>(ruta, { params })).data.data;
  return {
    saldosPendientes: (companiaId) => lista<SaldoPendiente>('/reports/pending-balances', { company_id: companiaId }),
    gasto: (periodo) => lista<GastoPorConcepto>('/reports/spend', periodo),
    cumplimiento: (periodo) => lista<CumplimientoPresupuesto>('/reports/budget-compliance', periodo),
    otraCompania: (periodo) => lista<FacturaOtraCompania>('/reports/intercompany-invoices', periodo),
    precisionIa: async (companiaId, mes) => (await http.get<PrecisionIa>(`/companies/${companiaId}/ai-accuracy`, { params: { month: mes } })).data,
    uso: async (mes) => (await http.get<UsoMes>('/usage', { params: { month: mes } })).data,
    excel: async (reporte, parametros) => {
      const respuesta = await http.get<Blob>(`/reports/${reporte}`, { params: { ...parametros, format: 'xlsx' }, responseType: 'blob' });
      return { archivo: respuesta.data, nombre: nombreArchivo(respuesta.headers['content-disposition'], `${reporte}.xlsx`) };
    },
  };
};
