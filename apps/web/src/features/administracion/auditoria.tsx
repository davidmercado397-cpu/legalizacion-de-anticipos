import { Link } from '@tanstack/react-router';
import type { FiltrosAuditoria } from '@viaticos/client-api';
import { useAuditoria, useEmpleados } from '@viaticos/client-app';
import type { RegistroAuditoria } from '@viaticos/contracts';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { formatoMomento } from '../../lib/formato';
import { useValorDiferido } from '../../lib/use-valor-diferido';
import { Boton } from '../../ui/boton';
import { Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Cargando, EstadoVacio } from '../../ui/superficies';

const TIPOS: Record<string, string> = {
  advance: 'Anticipos',
  expense: 'Gastos',
  employee: 'Usuarios',
  company: 'Compañías',
  settings: 'Configuración',
};
const POR_PAGINA = 50;

/** Rastro inmutable de quién hizo qué y cuándo: solo se insertan registros, nadie los edita ni los borra. */
export function Auditoria() {
  const [tipo, setTipo] = useState('');
  const [accion, setAccion] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(0);
  const accionDiferida = useValorDiferido(accion.trim(), 300);
  const filtros: FiltrosAuditoria = {
    limit: POR_PAGINA,
    offset: pagina * POR_PAGINA,
    ...(tipo && { entity_type: tipo }),
    ...(accionDiferida && { action: accionDiferida }),
    ...(desde && { since: new Date(`${desde}T00:00:00`).toISOString() }),
    ...(hasta && { until: new Date(`${hasta}T23:59:59`).toISOString() }),
  };
  const registros = useAuditoria(filtros);
  const personas = useEmpleados({ limit: 200 });
  const nombre = (id: string | null) => (id ? (personas.data?.data.find((e) => e.id === id)?.full_name ?? 'Usuario') : 'Sistema');
  const cambiar = (fn: () => void) => {
    fn();
    setPagina(0);
  };
  const total = registros.data?.pagination.total ?? 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Seleccion aria-label="Tipo de registro" className="w-auto" value={tipo} onChange={(e) => cambiar(() => setTipo(e.target.value))}>
          <option value="">Todo</option>
          {Object.entries(TIPOS).map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </Seleccion>
        <Entrada aria-label="Acción" placeholder="Acción (p. ej. advance_approve)" className="w-64" value={accion} onChange={(e) => cambiar(() => setAccion(e.target.value))} />
        <Entrada aria-label="Desde" type="date" className="w-auto" value={desde} onChange={(e) => cambiar(() => setDesde(e.target.value))} />
        <Entrada aria-label="Hasta" type="date" className="w-auto" value={hasta} onChange={(e) => cambiar(() => setHasta(e.target.value))} />
      </div>
      {registros.isPending ? (
        <Cargando />
      ) : registros.isError ? (
        <Alerta tono="peligro">{mensajeDeError(registros.error)}</Alerta>
      ) : registros.data.data.length === 0 ? (
        <EstadoVacio titulo="No hay registros con estos filtros" />
      ) : (
        <>
          <ul className={`divide-y divide-slate-200 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 ${registros.isPlaceholderData ? 'opacity-60' : ''}`}>
            {registros.data.data.map((r) => (
              <Registro key={r.id} registro={r} actor={nombre(r.actor_id)} />
            ))}
          </ul>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, total)} de {total}
            </span>
            <div className="flex gap-2">
              <Boton variante="secundario" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>
                Anteriores
              </Boton>
              <Boton variante="secundario" disabled={(pagina + 1) * POR_PAGINA >= total} onClick={() => setPagina(pagina + 1)}>
                Siguientes
              </Boton>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Registro({ registro: r, actor }: { registro: RegistroAuditoria; actor: string }) {
  const datos = Object.keys(r.data).length > 0;
  return (
    <li className="space-y-1 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="font-mono text-xs text-slate-800">{r.action}</span>
          <span className="text-slate-600"> · {actor}</span>
          {r.channel !== 'api' && <span className="text-slate-500"> · {r.channel === 'whatsapp' ? 'WhatsApp' : r.channel}</span>}
        </p>
        <span className="text-xs text-slate-500">{formatoMomento(r.created_at)}</span>
      </div>
      <p className="text-xs text-slate-500">
        {TIPOS[r.entity_type] ?? r.entity_type}
        {r.entity_type === 'advance' && r.entity_id ? (
          <>
            {' · '}
            <Link to="/anticipos/$anticipoId" params={{ anticipoId: r.entity_id }} className="text-marca-700 hover:underline">
              ver anticipo
            </Link>
          </>
        ) : (
          r.entity_id && <span className="font-mono"> · {r.entity_id}</span>
        )}
      </p>
      {datos && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">Detalle</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2">{JSON.stringify(r.data, null, 2)}</pre>
        </details>
      )}
    </li>
  );
}
