import { createFileRoute, redirect } from '@tanstack/react-router';
import { useSesion } from '@viaticos/client-app';
import { FileCheck2, type LucideIcon, ScanText, Wallet } from 'lucide-react';
import { useEffect } from 'react';
import { z } from 'zod';
import { FormularioLogin } from '../features/sesion/formulario-login';

/** Solo rutas internas: evita redirecciones abiertas a sitios externos. */
const rutaInterna = z
  .string()
  .refine((r) => r.startsWith('/') && !r.startsWith('//'))
  .optional()
  .catch(undefined);

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: rutaInterna }),
  beforeLoad: ({ context, search }) => {
    if (context.sesion.getState().estado === 'autenticada') throw redirect({ to: search.redirect ?? '/' });
  },
  component: PaginaLogin,
});

function PaginaLogin() {
  const { redirect: destino } = Route.useSearch();
  const navigate = Route.useNavigate();
  const estado = useSesion((s) => s.estado);

  useEffect(() => {
    if (estado === 'autenticada') void navigate({ to: destino ?? '/' });
  }, [estado, destino, navigate]);

  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col px-6 py-8 sm:px-12">
        <img src="/marca/logo.svg" alt="nextv.ia" className="h-8 w-auto self-start lg:hidden" />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <FormularioLogin />
        </div>
        <p className="text-xs text-slate-500">nextv.ia · Anticipos y legalización de gastos de viaje</p>
      </main>
      <PanelMarca />
    </div>
  );
}

const PASOS: { icono: LucideIcon; titulo: string; texto: string }[] = [
  { icono: Wallet, titulo: 'Pide el anticipo', texto: 'Con las tarifas de viaje ya calculadas; tu jefe lo aprueba desde WhatsApp.' },
  { icono: ScanText, titulo: 'Manda las facturas por WhatsApp', texto: 'La IA las lee; tú solo revisas y confirmas.' },
  { icono: FileCheck2, titulo: 'Legaliza sin papeles', texto: 'Contabilidad revisa todo en un lugar y lo envía a Siesa.' },
];

/** El lado de la marca: qué hace la aplicación, en tres pasos y en los colores del logo. Solo en pantallas anchas. */
function PanelMarca() {
  return (
    <aside className="relative hidden overflow-hidden bg-navy-950 px-12 py-16 text-white lg:flex lg:flex-col lg:justify-center xl:px-20">
      {/* El destello del logo, grande y tenue, como fondo. */}
      <svg viewBox="62 14 32 32" className="pointer-events-none absolute -top-24 -right-24 size-[28rem] text-destello opacity-10" aria-hidden>
        <path d="M78 14 Q78 30 94 30 Q78 30 78 46 Q78 30 62 30 Q78 30 78 14 Z" fill="currentColor" />
      </svg>
      <div className="relative max-w-md space-y-10">
        <img src="/marca/logo-claro.svg" alt="" className="h-9 w-auto" />
        <p className="text-3xl leading-tight font-extrabold tracking-tight">Del anticipo a la legalización, sin perseguir facturas.</p>
        <ol className="space-y-6">
          {PASOS.map(({ icono: Icono, titulo, texto }) => (
            <li key={titulo} className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-navy-800 text-destello">
                <Icono className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-bold">{titulo}</p>
                <p className="text-sm text-slate-300">{texto}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
