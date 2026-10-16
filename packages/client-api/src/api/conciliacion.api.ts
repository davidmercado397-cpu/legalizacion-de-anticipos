import type { AxiosInstance } from 'axios';
import type { DecisionCargo, Extracto, Lista, PerfilExtracto, VistaPreviaExtracto } from '@viaticos/contracts';

export interface ArchivoExtracto {
  archivo: Blob;
  nombre: string;
  /** Vacío = el que sugiere la API (o el fijo del PDF, que lee la IA). */
  perfil?: PerfilExtracto | null;
}

export type AccionMovimiento =
  | { tipo: 'confirmar' | 'deshacer' }
  | { tipo: 'enlazar'; gastoId: string }
  | { tipo: 'decidir'; decision: DecisionCargo };

export interface ConciliacionApi {
  vistaPrevia(anticipoId: string, archivo: ArchivoExtracto): Promise<VistaPreviaExtracto>;
  cargar(anticipoId: string, archivo: ArchivoExtracto, ultimos4?: string | null): Promise<Extracto>;
  extractos(anticipoId: string): Promise<Extracto[]>;
  movimiento(extractoId: string, movimientoId: string, accion: AccionMovimiento): Promise<Extracto>;
}

function formulario({ archivo, nombre, perfil }: ArchivoExtracto, ultimos4?: string | null): FormData {
  const datos = new FormData();
  datos.append('file', archivo, nombre);
  if (perfil) datos.append('profile', JSON.stringify(perfil));
  if (ultimos4) datos.append('card_last4', ultimos4);
  return datos;
}

const RUTAS = { confirmar: 'confirm', deshacer: 'reject', enlazar: 'link', decidir: 'decision' } as const;

export const crearConciliacionApi = (http: AxiosInstance): ConciliacionApi => ({
  vistaPrevia: async (anticipoId, archivo) =>
    (await http.post<VistaPreviaExtracto>(`/advances/${anticipoId}/statements/preview`, formulario(archivo))).data,
  // Un PDF lo lee la IA: puede tardar.
  cargar: async (anticipoId, archivo, ultimos4) =>
    (await http.post<Extracto>(`/advances/${anticipoId}/statements`, formulario(archivo, ultimos4), { timeout: 180_000 })).data,
  extractos: async (anticipoId) => (await http.get<Lista<Extracto>>(`/advances/${anticipoId}/statements`)).data.data,
  movimiento: async (extractoId, movimientoId, accion) => {
    const cuerpo = accion.tipo === 'enlazar' ? { expense_id: accion.gastoId } : accion.tipo === 'decidir' ? { decision: accion.decision } : {};
    const ruta = `/statements/${extractoId}/movements/${movimientoId}/${RUTAS[accion.tipo]}`;
    return (await http.post<Extracto>(ruta, cuerpo)).data;
  },
});
