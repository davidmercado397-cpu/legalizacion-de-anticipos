import type { LinkProps } from '@tanstack/react-router';
import { BookCheck, House, Landmark, type LucideIcon, ServerCog, Settings2, SquareCheckBig, Wallet } from 'lucide-react';
import type { Capacidad } from '../../lib/roles';

export interface EnlaceNav {
  to: LinkProps['to'];
  texto: string;
  icono: LucideIcon;
  capacidad: Capacidad;
  /** Solo activo en esa ruta exacta (el detalle de un anticipo también se abre desde otras bandejas). */
  exacta?: boolean;
}

/** La barra lateral: cada grupo aparece si el rol puede al menos uno de sus enlaces. */
export const GRUPOS: { titulo: string; enlaces: EnlaceNav[] }[] = [
  {
    titulo: 'Mi espacio',
    enlaces: [
      { to: '/', texto: 'Inicio', icono: House, capacidad: 'solicitar', exacta: true },
      { to: '/anticipos', texto: 'Mis anticipos', icono: Wallet, capacidad: 'solicitar', exacta: true },
      { to: '/aprobaciones', texto: 'Aprobaciones', icono: SquareCheckBig, capacidad: 'aprobar' },
    ],
  },
  {
    titulo: 'Gestión',
    enlaces: [
      { to: '/contabilidad', texto: 'Contabilidad', icono: BookCheck, capacidad: 'contabilidad' },
      { to: '/tesoreria', texto: 'Tesorería', icono: Landmark, capacidad: 'tesoreria' },
      { to: '/administracion', texto: 'Administración', icono: Settings2, capacidad: 'administrar' },
    ],
  },
  {
    titulo: 'Plataforma',
    enlaces: [{ to: '/plataforma', texto: 'Operación', icono: ServerCog, capacidad: 'plataforma' }],
  },
];
