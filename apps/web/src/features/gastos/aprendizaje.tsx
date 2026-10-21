import {
  useAccionAprendizaje,
  useAprendizajes,
  useCategorias,
  useConceptosBloqueados,
  useHistorialAprendizaje,
} from '@viaticos/client-app';
import type { FiltrosAprendizaje } from '@viaticos/client-api';
import type { Aprendizaje, EstadoAprendizaje, TipoAprendizaje } from '@viaticos/contracts';
import { ArrowRight, Brain } from 'lucide-react';
import { useState } from 'react';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { formatoMomento } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Campo, Seleccion } from '../../ui/campos';
import { EstadoConsulta } from '../../ui/estado-consulta';
import { Seccion } from '../../ui/pagina';
import { PanelLateral } from '../../ui/panel-lateral';
import { Alerta, EstadoVacio, Esqueleto, Insignia } from '../../ui/superficies';
import { Tabla } from '../../ui/tabla';

const PERMITIDO = 'none';
const TONO_ESTADO = { active: 'exito', pending: 'aviso', rejected: 'peligro', inactive: 'neutro' } as const;

/** Nombre de lo aprendido: un concepto excluido (o «permitido») para las líneas, una categoría para el NIT. */
function useEtiquetas(companiaId: string | undefined) {
  const conceptos = useConceptosBloqueados(companiaId);
  const categorias = useCategorias(companiaId);
  const nombreDe = (tipo: TipoAprendizaje, codigo: string) =>
    codigo === PERMITIDO
      ? 'Permitido'
      : ((tipo === 'line_concept' ? conceptos.data : categorias.data)?.find((c) => c.code === codigo)?.name ?? codigo);
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
  const filtros: FiltrosAprendizaje = {
    limit: 100,
    ...(tipo && { kind: tipo }),
    ...(estado && { status: estado }),
    ...(conflictos && { conflicted: true }),
  };
  return (
    <Seccion titulo="Lo que aprendió el sistema">
      <p className="-mt-1 max-w-prose text-sm text-slate-600">
        Cuando alguien corrige el concepto de una línea o la categoría de un proveedor, el sistema lo recuerda para las próximas facturas.
        Lo que corrige contabilidad queda activo; lo de un empleado espera que lo valide su jefe.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Tipo">
          {(p) => (
            <Seleccion {...p} className="w-auto" value={tipo} onChange={(e) => setTipo(e.target.value as TipoAprendizaje | '')}>
              <option value="">Todo</option>
              <option value="line_concept">{etiqueta('aprendizaje', 'line_concept')}</option>
              <option value="vendor_category">{etiqueta('aprendizaje', 'vendor_category')}</option>
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Estado">
          {(p) => (
            <Seleccion {...p} className="w-auto" value={estado} onChange={(e) => setEstado(e.target.value as EstadoAprendizaje | '')}>
              <option value="">Cualquiera</option>
              {(['active', 'pending', 'rejected', 'inactive'] as const).map((s) => (
                <option key={s} value={s}>
                  {etiqueta('aprendido', s)}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            className="size-4 accent-marca-600"
            checked={conflictos}
            onChange={(e) => setConflictos(e.target.checked)}
          />
          Solo los que chocan con el grupo
        </label>
      </div>
      <ListaAprendizajes filtros={filtros} companiaId={companiaId} gestiona />
    </Seccion>
  );
}

/** Jefes: correcciones de su equipo que esperan su validación. */
export function CorreccionesPorValidar() {
  const pendientes = useAprendizajes({ status: 'pending', limit: 50 });
  if (!pendientes.data?.data.length) return null;
  return (
    <Seccion titulo="Correcciones de tu equipo por validar" contador={pendientes.data.data.length}>
      <p className="-mt-1 text-sm text-slate-600">Si las validas, el sistema las usará para leer las próximas facturas.</p>
      <ListaAprendizajes
        filtros={{ status: 'pending', limit: 50 }}
        companiaId={pendientes.data.data[0]?.company_id ?? undefined}
        gestiona={false}
      />
    </Seccion>
  );
}

function ListaAprendizajes({
  filtros,
  companiaId,
  gestiona,
}: {
  filtros: FiltrosAprendizaje;
  companiaId: string | undefined;
  gestiona: boolean;
}) {
  const lista = useAprendizajes(filtros);
  const accion = useAccionAprendizaje();
  const etiquetas = useEtiquetas(companiaId);
  const [abierto, setAbierto] = useState<string | null>(null);
  const elegido = lista.data?.data.find((a) => a.id === abierto);
  return (
    <EstadoConsulta consulta={lista}>
      {(datos) =>
        datos.data.length === 0 ? (
          <EstadoVacio titulo="No hay nada aprendido con estos filtros" icono={Brain} />
        ) : (
          <>
            {accion.isError && <Alerta tono="peligro">{mensajeDeError(accion.error)}</Alerta>}
            <Tabla
              columnas={['Lo que dice', 'Lo que aprendió', { titulo: 'Estado', secundaria: true }, { titulo: 'Acciones', oculta: true }]}
              claves={datos.data.map((a) => a.id)}
              filas={datos.data.map((a) => {
                const ocupado = accion.isPending && accion.variables?.id === a.id;
                return [
                  <span className="block min-w-0">
                    <span className="block font-semibold break-words text-slate-900">«{a.original_text}»</span>
                    <span className="block text-slate-500">
                      {etiqueta('aprendizaje', a.kind)} · {a.scope === 'group' ? 'todo el grupo' : 'esta compañía'}
                    </span>
                  </span>,
                  <span className="inline-flex items-center gap-1.5">
                    <ArrowRight className="size-3.5 text-slate-400" aria-hidden />
                    {etiquetas.nombre(a)}
                  </span>,
                  <span className="flex flex-wrap gap-1">
                    <Insignia tono={TONO_ESTADO[a.status]}>{etiqueta('aprendido', a.status)}</Insignia>
                    {a.conflicted && <Insignia tono="aviso">Choca con el grupo</Insignia>}
                  </span>,
                  <span className="flex justify-end gap-2">
                    {a.status === 'pending' && (
                      <>
                        <Boton tamano="pequeno" cargando={ocupado} onClick={() => accion.mutate({ id: a.id, aprobado: true })}>
                          Validar
                        </Boton>
                        <Boton
                          variante="secundario"
                          tamano="pequeno"
                          disabled={ocupado}
                          onClick={() => accion.mutate({ id: a.id, aprobado: false })}
                        >
                          No validar
                        </Boton>
                      </>
                    )}
                    <Boton variante={a.status === 'pending' ? 'fantasma' : 'secundario'} tamano="pequeno" onClick={() => setAbierto(a.id)}>
                      Abrir
                    </Boton>
                  </span>,
                ];
              })}
            />
            <PanelLateral
              abierto={!!elegido}
              titulo={elegido ? `«${elegido.original_text}»` : 'Aprendizaje'}
              descripcion={elegido && etiqueta('aprendizaje', elegido.kind)}
              alCerrar={() => setAbierto(null)}
            >
              {elegido && <Ficha aprendizaje={elegido} etiquetas={etiquetas} gestiona={gestiona} accion={accion} />}
            </PanelLateral>
          </>
        )
      }
    </EstadoConsulta>
  );
}

/** En el panel: corregir lo aprendido, compartirlo o desactivarlo, y su historial. */
function Ficha({
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
  const ocupado = accion.isPending && accion.variables?.id === a.id;
  const opciones = a.kind === 'line_concept' ? [{ code: PERMITIDO, name: 'Permitido' }, ...etiquetas.conceptos] : etiquetas.categorias;
  return (
    <>
      <div className="flex flex-wrap gap-1">
        <Insignia tono={TONO_ESTADO[a.status]}>{etiqueta('aprendido', a.status)}</Insignia>
        {a.conflicted && <Insignia tono="aviso">Choca con el grupo</Insignia>}
      </div>
      {gestiona ? (
        <div className="space-y-4">
          <Campo etiqueta={a.kind === 'line_concept' ? 'Concepto' : 'Categoría'}>
            {(p) => (
              <Seleccion
                {...p}
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
            )}
          </Campo>
          <div className="flex flex-wrap gap-2">
            <Boton
              variante="secundario"
              tamano="pequeno"
              disabled={ocupado}
              onClick={() => accion.mutate({ id: a.id, cambios: { scope: a.scope === 'group' ? 'company' : 'group' } })}
            >
              {a.scope === 'group' ? 'Solo para esta compañía' : 'Compartir con el grupo'}
            </Boton>
            <Boton
              variante="secundario"
              tamano="pequeno"
              disabled={ocupado}
              onClick={() => accion.mutate({ id: a.id, cambios: { active: a.status === 'inactive' } })}
            >
              {a.status === 'inactive' ? 'Activar' : 'Desactivar'}
            </Boton>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-700">
          Lo aprendido: <span className="font-semibold">{etiquetas.nombre(a)}</span>
        </p>
      )}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900">Historial</h3>
        <Historial id={a.id} nombre={(codigo) => etiquetas.nombreDe(a.kind, codigo)} />
      </section>
    </>
  );
}

function Historial({ id, nombre }: { id: string; nombre: (codigo: string) => string }) {
  const historial = useHistorialAprendizaje(id);
  if (historial.isPending) return <Esqueleto filas={3} />;
  if (historial.isError) return <Alerta tono="peligro">{mensajeDeError(historial.error)}</Alerta>;
  return (
    <ol className="space-y-3">
      {historial.data.map((h, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
          <span>
            <span className="font-semibold text-slate-900">{etiqueta('cambio_aprendizaje', h.action)}</span>
            {typeof h.after?.label === 'string' && h.before?.label !== h.after.label && (
              <span className="text-slate-700">
                {' '}
                ({typeof h.before?.label === 'string' ? nombre(h.before.label) : '—'} a {nombre(h.after.label)})
              </span>
            )}
            <span className="block text-slate-500">{formatoMomento(h.created_at)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
