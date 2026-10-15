import { useEffect, useState } from 'react';

/** Devuelve `valor` solo después de `ms` sin cambios (debounce). */
export function useValorDiferido<T>(valor: T, ms: number): T {
  const [diferido, setDiferido] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setDiferido(valor), ms);
    return () => clearTimeout(id);
  }, [valor, ms]);
  return diferido;
}
