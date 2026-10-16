import { DomainError, normalizarIdentificacionTributaria } from '@viaticos/shared-kernel';

/** Empresa del holding: las facturas de sus empleados deben venir a su NIT. */
export interface Empresa {
  readonly id: string;
  readonly nombre: string;
  readonly nit: string;
  readonly activa: boolean;
}

export function crearEmpresa(datos: { id: string; nombre: string; nit: string; activa: boolean }): Empresa {
  const nombre = datos.nombre.trim();
  const nit = normalizarIdentificacionTributaria(datos.nit) ?? '';
  if (nombre.length < 2) throw new DomainError('NOMBRE_REQUERIDO', 'VALIDACION', 'Escriba el nombre de la empresa');
  if (!/^\d{6,15}$/.test(nit)) throw new DomainError('NIT_INVALIDO', 'VALIDACION', 'El NIT debe tener entre 6 y 15 dígitos (sin dígito de verificación)');
  return { id: datos.id, nombre, nit, activa: datos.activa };
}

/** Cargo: define las tarifas de viáticos que aplican al empleado. */
export interface Cargo {
  readonly codigo: string;
  readonly nombre: string;
  readonly activo: boolean;
}

export function crearCargo(datos: Cargo): Cargo {
  const codigo = datos.codigo.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(codigo)) {
    throw new DomainError('CODIGO_INVALIDO', 'VALIDACION', 'El código usa mayúsculas, números y guion bajo (ej. GERENTE_REGIONAL)');
  }
  const nombre = datos.nombre.trim();
  if (nombre.length < 2) throw new DomainError('NOMBRE_REQUERIDO', 'VALIDACION', 'Escriba el nombre del cargo');
  return { codigo, nombre, activo: datos.activo };
}

export interface EmpresaRepository {
  listar(): Promise<Empresa[]>;
  obtenerPorId(id: string): Promise<Empresa | null>;
  guardar(empresa: Empresa): Promise<void>;
}

export interface CargoRepository {
  listar(): Promise<Cargo[]>;
  guardar(cargo: Cargo): Promise<void>;
}
