import type { FechaCalendario } from '@viaticos/shared-kernel';
import type { TarifaAplicable } from '../domain/presupuesto-viaje';

/** Tarifas vigentes para un cargo y país (lo implementa un adaptador al módulo de tarifas). */
export interface ConsultaTarifas {
  vigentes(cargoId: string, paisCodigo: string, fecha: FechaCalendario): Promise<TarifaAplicable[]>;
}

export interface PerfilViajero {
  id: string;
  cargoId: string;
  jefeInmediatoId: string | null;
  jefeDirectivoId: string | null;
}

/** Datos organizacionales del viajero (lo implementa un adaptador al módulo de organización). */
export interface DirectorioOrganizacional {
  obtenerViajero(usuarioId: string): Promise<PerfilViajero | null>;
}
