import { useCompanias } from '@viaticos/client-app';
import { useState } from 'react';

const LLAVE = 'viaticos.compania';

function leer(): string {
  try {
    return sessionStorage.getItem(LLAVE) ?? '';
  } catch {
    return '';
  }
}

/** La compañía que se configura en las pantallas de contabilidad; se recuerda mientras dure la pestaña. */
export function useCompaniaElegida() {
  const companias = useCompanias();
  const [elegida, setElegida] = useState(leer);
  const lista = companias.data ?? [];
  const id = lista.some((c) => c.id === elegida) ? elegida : lista[0]?.id;
  const elegir = (nueva: string) => {
    setElegida(nueva);
    try {
      sessionStorage.setItem(LLAVE, nueva);
    } catch {
      // Sin almacenamiento (modo privado): se elige de nuevo al volver.
    }
  };
  return { companias: lista, id, compania: lista.find((c) => c.id === id), elegir };
}
