import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { mensajeDeError } from '../lib/errores';
import { Boton } from './boton';
import { Alerta, Esqueleto } from './superficies';

/** Lo que la web necesita de una consulta (sin depender de react-query: lo da cualquier hook de client-app). */
export interface Consulta<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  refetch: () => unknown;
  isPlaceholderData?: boolean;
}

interface Props<T> {
  consulta: Consulta<T>;
  children: (datos: T) => ReactNode;
  /** Lo que se muestra mientras carga; por defecto un esqueleto de lista. */
  cargando?: ReactNode;
}

/** Carga, error con reintento y contenido: el mismo trato en todas las pantallas. */
export function EstadoConsulta<T>({ consulta, children, cargando }: Props<T>) {
  if (consulta.isPending) return <>{cargando ?? <Esqueleto />}</>;
  if (consulta.isError || consulta.data === undefined) {
    return (
      <Alerta tono="peligro">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{mensajeDeError(consulta.error)}</span>
          <Boton variante="secundario" tamano="pequeno" onClick={() => consulta.refetch()}>
            <RotateCw aria-hidden />
            Reintentar
          </Boton>
        </div>
      </Alerta>
    );
  }
  // Mientras llegan los datos de otro filtro se ven los anteriores, atenuados.
  return <div className={consulta.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>{children(consulta.data)}</div>;
}
