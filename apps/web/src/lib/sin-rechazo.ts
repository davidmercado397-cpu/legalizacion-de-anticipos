/**
 * Para envíos con `mutateAsync`: el error ya lo muestra la mutación (`isError`), así que aquí solo se evita
 * que quede una promesa rechazada sin manejar.
 */
export function sinRechazo<A extends unknown[]>(accion: (...args: A) => Promise<unknown>): (...args: A) => Promise<void> {
  return (...args) => accion(...args).then(
    () => undefined,
    () => undefined,
  );
}
