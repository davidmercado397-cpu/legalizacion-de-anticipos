/** Tokens de inyección para los puertos transversales (ADR-0003). */
export const RELOJ = Symbol('Reloj');
export const GENERADOR_IDS = Symbol('GeneradorIds');
export const PUBLICADOR_EVENTOS = Symbol('PublicadorEventos');
export const PROVEEDOR_TASA_CAMBIO = Symbol('ProveedorTasaCambio');
export const CONFIGURACION = Symbol('Configuracion');
/** ConexionBaseDatos, o null con PERSISTENCIA=memoria. */
export const CONEXION_BASE_DATOS = Symbol('ConexionBaseDatos');
/** Mismo bus: publica y permite suscribirse (BusEventos). */
export const BUS_EVENTOS = PUBLICADOR_EVENTOS;
export const COLA_TRABAJOS = Symbol('ColaTrabajos');
