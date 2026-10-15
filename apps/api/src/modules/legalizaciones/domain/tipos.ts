import type { FechaCalendario, Money, TasaCambio } from '@viaticos/shared-kernel';

export const CATEGORIAS_GASTO = ['ALOJAMIENTO', 'ALIMENTACION', 'VIVERES', 'TRANSPORTE', 'OTROS'] as const;
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

export const MEDIOS_PAGO = ['TARJETA', 'EFECTIVO', 'TRANSFERENCIA', 'DESCONOCIDO'] as const;
export type MedioPago = (typeof MEDIOS_PAGO)[number];

export type TipoClaveFiscal = 'CUFE' | 'CUDE' | 'CHAVE_ACESSO_BR';

/** Lo que leyó el OCR, tal cual (puede venir incompleto). Se guarda para auditoría. */
export interface DatosExtraidos {
  tipoDocumento: 'FACTURA_ELECTRONICA' | 'FACTURA' | 'TIQUETE_POS' | 'RECIBO' | 'OTRO';
  emisorNombre: string | null;
  emisorId: string | null;
  adquirienteNombre: string | null;
  adquirienteId: string | null;
  numeroDocumento: string | null;
  fecha: string | null;
  moneda: string | null;
  total: string | null;
  claveFiscal: { tipo: TipoClaveFiscal; valor: string } | null;
  medioPago: MedioPago;
  ultimos4Tarjeta: string | null;
  paisCodigo: string | null;
  categoriaSugerida: CategoriaGasto;
  lineas: Array<{ descripcion: string; valor: string }>;
  confianza: 'ALTA' | 'MEDIA' | 'BAJA';
  observaciones: string | null;
}

export interface LineaSoporte {
  descripcion: string;
  valor: Money;
  excluida: boolean;
  motivoExclusion: string | null;
}

/** Datos del soporte confirmados por el viajero (fuente de verdad para la legalización). */
export interface DatosSoporte {
  emisorNombre: string;
  emisorId: string | null;
  adquirienteId: string | null;
  numeroDocumento: string | null;
  fecha: FechaCalendario;
  total: Money;
  claveFiscal: { tipo: TipoClaveFiscal; valor: string } | null;
  medioPago: MedioPago;
  ultimos4Tarjeta: string | null;
  paisCodigo: string;
  categoria: CategoriaGasto;
  lineas: LineaSoporte[];
  /** Tasa usada para llevar el total a la moneda del anticipo (null si es la misma moneda). */
  tasa: TasaCambio | null;
}

export type CodigoAlerta =
  | 'NO_A_NOMBRE_EMPRESA'
  | 'POSIBLE_DUPLICADO'
  | 'FECHA_FUERA_DEL_VIAJE'
  | 'SIN_CLAVE_FISCAL'
  | 'LINEAS_EXCLUIDAS'
  | 'TOTAL_NO_CUADRA'
  | 'LECTURA_NO_DISPONIBLE'
  | 'RECIBO_CAJA_222';

/** REVISION: contabilidad debe decidir si el soporte aplica. INFO: solo informa. */
export interface Alerta {
  codigo: CodigoAlerta;
  severidad: 'INFO' | 'REVISION';
  mensaje: string;
}

export interface ArchivoSoporte {
  clave: string;
  nombre: string;
  mime: string;
  tamano: number;
  sha256: string;
}

export interface DecisionContable {
  aplica: boolean;
  comentario: string | null;
  contadorId: string;
  decididoEn: Date;
}
