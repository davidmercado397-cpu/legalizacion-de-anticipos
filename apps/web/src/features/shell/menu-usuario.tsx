import { Link } from '@tanstack/react-router';
import { useCerrarSesion, useSesion } from '@viaticos/client-app';
import { ChevronsUpDown, KeyRound, LogOut } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { etiqueta } from '../../i18n';

const OPCION =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 [&_svg]:size-4 [&_svg]:text-slate-500';

function iniciales(nombre: string | undefined) {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || '·';
}

/** Quién está conectado, abajo de la barra lateral; al tocarlo, su cuenta y salir. */
export function MenuUsuario({ alElegir }: { alElegir?: () => void }) {
  const usuario = useSesion((s) => s.usuario);
  const cerrar = useCerrarSesion();
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const idPanel = useId();

  // Se cierra con Escape o al tocar fuera.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => !raiz.current?.contains(e.target as Node) && setAbierto(false);
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('pointerdown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  const elegir = () => {
    setAbierto(false);
    alElegir?.();
  };

  return (
    <div ref={raiz} className="relative">
      {abierto && (
        <div
          id={idPanel}
          className="absolute inset-x-0 bottom-full mb-2 space-y-0.5 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200"
        >
          <Link to="/cuenta/clave" className={OPCION} onClick={elegir}>
            <KeyRound aria-hidden />
            Cambiar contraseña
          </Link>
          <button type="button" className={OPCION} disabled={cerrar.isPending} onClick={() => cerrar.mutate()}>
            <LogOut aria-hidden />
            Cerrar sesión
          </button>
        </div>
      )}
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={idPanel}
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left hover:bg-white hover:ring-1 hover:ring-slate-200"
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-navy-950 text-[13px] font-bold text-white"
          aria-hidden
        >
          {iniciales(usuario?.full_name)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold text-slate-900">{usuario?.full_name}</span>
          <span className="block truncate text-xs text-slate-500">{etiqueta('rol', usuario?.role)}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-slate-500" aria-hidden />
        <span className="sr-only">Opciones de la cuenta</span>
      </button>
    </div>
  );
}
