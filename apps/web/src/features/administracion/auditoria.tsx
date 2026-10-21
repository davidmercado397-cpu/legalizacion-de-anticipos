import { Link } from '@tanstack/react-router';
import type { FiltrosAuditoria } from '@viaticos/client-api';
import { useAuditoria, useEmpleados } from '@viaticos/client-app';
import type { RegistroAuditoria } from '@viaticos/contracts';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { formatoMomento } from '../../lib/formato';
import { useValorDiferido } from '../../lib/use-valor-diferido';
import { Boton, botonClases } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { EstadoConsulta } from '../../ui/estado-consulta';
import { Seccion } from '../../ui/pagina';
import { EstadoVacio } from '../../ui/superficies';
import { Tabla } from '../../ui/tabla';

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
    <Seccion titulo="Registro de auditoría" {...(registros.data ? { contador: total } : {})}>
      <p className="-mt-1 max-w-prose text-sm text-slate-600">
        Quién hizo qué y cuándo. Los registros solo se agregan: nadie los edita ni los borra.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Sobre">
          {(p) => (
            <Seleccion {...p} className="w-auto" value={tipo} onChange={(e) => cambiar(() => setTipo(e.target.value))}>
              <option value="">Todo</option>
              {Object.entries(TIPOS).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Acción" className="w-full sm:w-64">
          {(p) => (
            <Entrada
              {...p}
              placeholder="Por ejemplo advance_approve"
              value={accion}
              onChange={(e) => cambiar(() => setAccion(e.target.value))}
            />
          )}
        </Campo>
        <Campo etiqueta="Desde">
          {(p) => <Entrada {...p} type="date" className="w-auto" value={desde} onChange={(e) => cambiar(() => setDesde(e.target.value))} />}
        </Campo>
        <Campo etiqueta="Hasta">
          {(p) => <Entrada {...p} type="date" className="w-auto" value={hasta} onChange={(e) => cambiar(() => setHasta(e.target.value))} />}
        </Campo>
      </div>
      <EstadoConsulta consulta={registros}>
        {(datos) =>
          datos.data.length === 0 ? (
            <EstadoVacio titulo="No hay registros con estos filtros" icono={ScrollText} />
          ) : (
            <div className="space-y-4">
              <Tabla
                columnas={['Cuándo', 'Acción', 'Quién', { titulo: 'Sobre', secundaria: true }]}
                claves={datos.data.map((r) => r.id)}
                filas={datos.data.map((r) => [
                  <span className="whitespace-nowrap text-slate-600">{formatoMomento(r.created_at)}</span>,
                  <Accion registro={r} />,
                  <span>
                    {nombre(r.actor_id)}
                    {r.channel !== 'api' && (
                      <span className="block text-xs text-slate-500">{r.channel === 'whatsapp' ? 'por WhatsApp' : r.channel}</span>
                    )}
                  </span>,
                  <Sobre registro={r} />,
                ])}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
                <span className="tabular-nums">
                  {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, total)} de {total}
                </span>
                <div className="flex gap-2">
                  <Boton variante="secundario" tamano="pequeno" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>
                    <ChevronLeft aria-hidden />
                    Anteriores
                  </Boton>
                  <Boton
                    variante="secundario"
                    tamano="pequeno"
                    disabled={(pagina + 1) * POR_PAGINA >= total}
                    onClick={() => setPagina(pagina + 1)}
                  >
                    Siguientes
                    <ChevronRight aria-hidden />
                  </Boton>
                </div>
              </div>
            </div>
          )
        }
      </EstadoConsulta>
    </Seccion>
  );
}

/** El código de la acción y, si trae datos, su detalle desplegable. */
function Accion({ registro: r }: { registro: RegistroAuditoria }) {
  return (
    <span className="block min-w-0">
      <span className="font-mono text-xs text-slate-900">{r.action}</span>
      {Object.keys(r.data).length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-900">Detalle</summary>
          <pre className="mt-1 max-w-md overflow-x-auto rounded-lg bg-slate-50 p-2">{JSON.stringify(r.data, null, 2)}</pre>
        </details>
      )}
    </span>
  );
}

function Sobre({ registro: r }: { registro: RegistroAuditoria }) {
  const tipo = TIPOS[r.entity_type] ?? r.entity_type;
  if (r.entity_type === 'advance' && r.entity_id)
    return (
      <Link
        to="/anticipos/$anticipoId"
        params={{ anticipoId: r.entity_id }}
        className={botonClases({ variante: 'secundario', tamano: 'pequeno' })}
      >
        Ver anticipo
      </Link>
    );
  return <span className="text-slate-600">{tipo}</span>;
}
