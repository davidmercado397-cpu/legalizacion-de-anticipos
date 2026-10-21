import { useAccionAprendizaje, useAprendizajes, useCategorias, useConceptosBloqueados, useHistorialAprendizaje } from '@viaticos/client-app';
import type { FiltrosAprendizaje } from '@viaticos/client-api';
import type { Aprendizaje, EstadoAprendizaje, TipoAprendizaje } from '@viaticos/contracts';
import { useState } from 'react';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { formatoMomento } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Seleccion } from '../../ui/campos';
import { Alerta, Cargando, EstadoVacio, Insignia } from '../../ui/superficies';

const PERMITIDO = 'none';
const TONO_ESTADO = { active: 'exito', pending: 'aviso', rejected: 'peligro', inactive: 'neutro' } as const;

/** Nombre de lo aprendido: un concepto excluido (o «permitido») para las líneas, una categoría para el NIT. */
function useEtiquetas(companiaId: string | undefined) {
  const conceptos = useConceptosBloqueados(companiaId);
  const categorias = useCategorias(companiaId);
  const nombreDe = (tipo: TipoAprendizaje, codigo: string) =>
    codigo === PERMITIDO ? 'Permitido' : ((tipo === 'line_concept' ? conceptos.data : categorias.data)?.find((c) => c.code === codigo)?.name ?? codigo);
  return {
    conceptos: conceptos.data ?? [],
    categorias: categorias.data ?? [],
    nombreDe,
    nombre: (a: Aprendizaje) => nombreDe(a.kind, a.label),
  };
}

/** Contabilidad: lo que el sistema aprendió de las correcciones; se corrige, se comparte con el grupo o se desactiva. */
export function GestionAprendizaje({ companiaId }: { companiaId: string | undefined }) {
  const [tipo, setTipo] = useState<TipoAprendizaje | ''>('');
  const [estado, setEstado] = useState<EstadoAprendizaje | ''>('active');
  const [conflictos, setConflictos] = useState(false);
  const filtros: FiltrosAprendizaje = { limit: 100, ...(tipo && { kind: tipo }), ...(estado && { status: estado }), ...(conflictos && { conflicted: true }) };
  return (
    <section className="space-y-3">
      <p className="text-sm text-slate-600">
        Cuando alguien corrige el concepto de una línea o la categoría de un proveedor, el sistema lo recuerda para las próximas facturas. Lo que
        corrige contabilidad queda activo; lo de un empleado espera que lo valide su jefe.
      </p>
      <div className="flex flex-wrap gap-2">
        <Seleccion aria-label="Tipo" className="w-auto" value={tipo} onChange={(e) => setTipo(e.target.value as TipoAprendizaje | '')}>
          <option value="">Todo</option>
          <option value="line_concept">{etiqueta('aprendizaje', 'line_concept')}</option>
          <option value="vendor_category">{etiqueta('aprendizaje', 'vendor_category')}</option>
        </Seleccion>
        <Seleccion aria-label="Estado" className="w-auto" value={estado} onChange={(e) => setEstado(e.target.value as EstadoAprendizaje | '')}>
          <option value="">Cualquier estado</option>
          {(['active', 'pending', 'rejected', 'inactive'] as const).map((s) => (
            <option key={s} value={s}>
              {etiqueta('aprendido', s)}
            </option>
          ))}
        </Seleccion>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={conflictos} onChange={(e) => setConflictos(e.target.checked)} />
          Solo los que chocan con el grupo
        </label>
      </div>
      <ListaAprendizajes filtros={filtros} companiaId={companiaId} gestiona />
    </section>
  );
}

/** Jefes: correcciones de su equipo que esperan su validación. */
export function CorreccionesPorValidar() {
  const pendientes = useAprendizajes({ status: 'pending', limit: 50 });
  if (!pendientes.data?.data.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-slate-700">Correcciones de su equipo por validar</h2>
      <p className="text-sm text-slate-600">Si las valida, el sistema las usará para leer las próximas facturas.</p>
      <ListaAprendizajes filtros={{ status: 'pending', limit: 50 }} companiaId={pendientes.data.data[0]?.company_id ?? undefined} gestiona={false} />
    </section>
  );
}

function ListaAprendizajes({ filtros, companiaId, gestiona }: { filtros: FiltrosAprendizaje; companiaId: string | undefined; gestiona: boolean }) {
  const lista = useAprendizajes(filtros);
  const accion = useAccionAprendizaje();
  const etiquetas = useEtiquetas(companiaId);
  if (lista.isPending) return <Cargando />;
  if (lista.isError) return <Alerta tono="peligro">{mensajeDeError(lista.error)}</Alerta>;
  if (lista.data.data.length === 0) return <EstadoVacio titulo="No hay nada aprendido con estos filtros" />;
  return (
    <>
      {accion.isError && <Alerta tono="peligro">{mensajeDeError(accion.error)}</Alerta>}
      <ul className="divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200">
        {lista.data.data.map((a) => (
          <Fila key={a.id} aprendizaje={a} etiquetas={etiquetas} gestiona={gestiona} accion={accion} />
        ))}
      </ul>
    </>
  );
}

function Fila({
  aprendizaje: a,
  etiquetas,
  gestiona,
  accion,
}: {
  aprendizaje: Aprendizaje;
  etiquetas: ReturnType<typeof useEtiquetas>;
  gestiona: boolean;
  accion: ReturnType<typeof useAccionAprendizaje>;
}) {
  const [historial, setHistorial] = useState(false);
  const ocupado = accion.isPending && accion.variables?.id === a.id;
  const opciones = a.kind === 'line_concept' ? [{ code: PERMITIDO, name: 'Permitido' }, ...etiquetas.conceptos] : etiquetas.categorias;
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">
            «{a.original_text}» → {etiquetas.nombre(a)}
          </p>
          <p className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
            {etiqueta('aprendizaje', a.kind)} · {a.scope === 'group' ? 'todo el grupo' : 'esta compañía'} ·
            <Insignia tono={TONO_ESTADO[a.status]}>{etiqueta('aprendido', a.status)}</Insignia>
            {a.conflicted && <Insignia tono="aviso">Choca con el grupo</Insignia>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {a.status === 'pending' && (
            <>
              <Boton cargando={ocupado} onClick={() => accion.mutate({ id: a.id, aprobado: true })}>
                Validar
              </Boton>
              <Boton variante="fantasma" className="text-red-700" disabled={ocupado} onClick={() => accion.mutate({ id: a.id, aprobado: false })}>
                No validar
              </Boton>
            </>
          )}
          {gestiona && (
            <>
              <Seleccion
                aria-label={`Corregir «${a.original_text}»`}
                className="w-auto"
                value={a.label}
                disabled={ocupado}
                onChange={(e) => accion.mutate({ id: a.id, cambios: { label: e.target.value } })}
              >
                {opciones.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
              </Seleccion>
              <Boton
                variante="fantasma"
                disabled={ocupado}
                onClick={() => accion.mutate({ id: a.id, cambios: { scope: a.scope === 'group' ? 'company' : 'group' } })}
              >
                {a.scope === 'group' ? 'Solo esta compañía' : 'Compartir con el grupo'}
              </Boton>
              <Boton variante="fantasma" disabled={ocupado} onClick={() => accion.mutate({ id: a.id, cambios: { active: a.status === 'inactive' } })}>
                {a.status === 'inactive' ? 'Activar' : 'Desactivar'}
              </Boton>
            </>
          )}
          <Boton variante="fantasma" aria-expanded={historial} onClick={() => setHistorial(!historial)}>
            Historial
          </Boton>
        </div>
      </div>
      {historial && <Historial id={a.id} nombre={(codigo) => etiquetas.nombreDe(a.kind, codigo)} />}
    </li>
  );
}

function Historial({ id, nombre }: { id: string; nombre: (codigo: string) => string }) {
  const historial = useHistorialAprendizaje(id);
  if (historial.isPending) return <Cargando />;
  if (historial.isError) return <Alerta tono="peligro">{mensajeDeError(historial.error)}</Alerta>;
  return (
    <ol className="space-y-1 border-l-2 border-slate-200 pl-3 text-xs text-slate-600">
      {historial.data.map((h, i) => (
        <li key={i}>
          {formatoMomento(h.created_at)} · {etiqueta('cambio_aprendizaje', h.action)}
          {typeof h.after?.label === 'string' &&
            h.before?.label !== h.after.label &&
            ` (${typeof h.before?.label === 'string' ? nombre(h.before.label) : '—'} → ${nombre(h.after.label)})`}
        </li>
      ))}
    </ol>
  );
}
