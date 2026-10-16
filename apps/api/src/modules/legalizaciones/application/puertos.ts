import type { DatosExtraidos } from '../domain/tipos';

export interface AlmacenArchivos {
  guardar(clave: string, contenido: Buffer, mime: string): Promise<void>;
  leer(clave: string): Promise<Buffer>;
  eliminar(clave: string): Promise<void>;
}

/** OCR + interpretación del comprobante. `automatico = false`: no hay lectura, el viajero digita. */
export interface ExtractorComprobantes {
  readonly automatico: boolean;
  extraer(entrada: {
    contenido: Buffer;
    mime: string;
    descripcionUsuario: string;
    paisesViaje: string[];
  }): Promise<DatosExtraidos | null>;
}

/** Empresa del holding del viajero: sus facturas deben venir a ese NIT (módulo de organización). */
export interface DirectorioEmpresas {
  empresaDe(viajeroId: string): Promise<{ nombre: string; nit: string } | null>;
}

/** Cola de trabajos en segundo plano (en proceso hoy; pg-boss después, ADR-0004). */
export interface ColaTrabajos {
  encolar(nombre: string, trabajo: () => Promise<void>): void;
}

export interface HuellaSoporte {
  sha256: string;
  claveFiscal?: { tipo: 'CUFE' | 'CUDE' | 'CHAVE_ACESSO_BR'; valor: string } | null;
  emisorId?: string | null;
  numeroDocumento?: string | null;
  fecha?: string | null;
  total?: { monto: string; moneda: string } | null;
}

/** Capa anti-duplicados (módulo comprobantes). */
export interface ControlDuplicadosPort {
  /** Chequeo barato por SHA-256 antes de guardar y pagar OCR. */
  archivoYaRadicado(sha256: string): Promise<boolean>;
  /** Verifica y registra la huella completa. Lanza COMPROBANTE_DUPLICADO si está bloqueado. */
  registrar(soporteId: string, viajeroId: string, huella: HuellaSoporte): Promise<{ veredicto: 'UNICO' | 'SOSPECHOSO'; detalle: string | null }>;
  anular(soporteId: string): Promise<void>;
}
