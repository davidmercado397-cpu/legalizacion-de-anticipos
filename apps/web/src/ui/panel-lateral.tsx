import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Boton } from './boton';

/**
 * Un panel que entra por la derecha sobre la lista, para ver o editar un elemento sin perder el lugar en ella. Es un
 * `<dialog>` modal: atrapa el foco, se cierra con Escape, con la X o tocando fuera.
 */
export function PanelLateral({
  abierto,
  titulo,
  descripcion,
  alCerrar,
  children,
}: {
  abierto: boolean;
  titulo: ReactNode;
  descripcion?: ReactNode;
  alCerrar: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) {
      // jsdom no implementa showModal; ahí basta con el atributo.
      if (typeof dialogo.showModal === 'function') dialogo.showModal();
      else dialogo.setAttribute('open', '');
    } else if (!abierto && dialogo.open) {
      dialogo.close();
    }
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      onClose={alCerrar}
      onClick={(e) => e.target === e.currentTarget && alCerrar()}
      className="m-0 ml-auto h-dvh max-h-none w-[32rem] max-w-full bg-white p-0 shadow-xl backdrop:bg-navy-950/40"
    >
      {abierto && (
        <div className="flex h-full flex-col">
          <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id={idTitulo} className="truncate text-lg font-bold tracking-tight text-slate-900">
                {titulo}
              </h2>
              {descripcion && <div className="text-sm text-slate-600">{descripcion}</div>}
            </div>
            <Boton variante="fantasma" tamano="pequeno" className="-mr-2 px-2" aria-label="Cerrar" onClick={alCerrar}>
              <X aria-hidden />
            </Boton>
          </header>
          <div className="flex-1 space-y-8 overflow-y-auto px-5 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
