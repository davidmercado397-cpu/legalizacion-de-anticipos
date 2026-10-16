import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { archivoSoporteOptions, useApi, useDecidirLinea } from '@viaticos/client-app';
import type { LegalizacionResponse, SoporteResponse } from '@viaticos/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { cx } from '../../lib/cx';
import { formatoDinero, formatoFechaCalendario, formatoMomento } from '../../lib/formato';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Alerta, Insignia, Tarjeta } from '../../ui/superficies';

const TONO_LEG = { ABIERTA: 'info', EN_REVISION: 'aviso', DEVUELTA: 'peligro', APROBADA: 'exito' } as const;
const TONO_SOP = { PROCESANDO: 'neutro', POR_CONFIRMAR: 'aviso', CONFIRMADO: 'exito' } as const;

export const InsigniaEstadoLegalizacion = ({ estado }: { estado: LegalizacionResponse['estado'] }) => (
  <Insignia tono={TONO_LEG[estado]}>{t(`estadoLegalizacion.${estado}`)}</Insignia>
);

export function ResumenSaldo({ legalizacion: l }: { legalizacion: LegalizacionResponse }) {
  const saldo = Number(l.resumen.saldo.monto);
  const absoluto = { ...l.resumen.saldo, monto: Math.abs(saldo).toFixed(2) };
  return (
    <Tarjeta className="grid gap-4 sm:grid-cols-4">
      <Dato titulo="Anticipo recibido" valor={formatoDinero(l.montoAnticipo)} />
      <Dato titulo="Gastos reconocidos" valor={formatoDinero(l.resumen.totalAceptado)} />
      <Dato titulo="Excluido por política" valor={formatoDinero(l.resumen.totalExcluido)} tono={Number(l.resumen.totalExcluido.monto) > 0 ? 'aviso' : undefined} />
      <Dato
        titulo={saldo > 0 ? 'Debe reintegrar' : saldo < 0 ? 'La empresa le reembolsa' : 'Saldo'}
        valor={formatoDinero(absoluto)}
        tono={saldo > 0 ? 'peligro' : saldo < 0 ? 'exito' : undefined}
        destacado
      />
    </Tarjeta>
  );
}

function Dato({ titulo, valor, tono, destacado }: { titulo: string; valor: string; tono?: 'aviso' | 'peligro' | 'exito' | undefined; destacado?: boolean }) {
  return (
    <div>
      <p className="text-sm text-slate-500">{titulo}</p>
      <p
        className={cx(
          destacado ? 'text-2xl font-bold' : 'text-lg font-semibold',
          tono === 'aviso' && 'text-amber-800',
          tono === 'peligro' && 'text-red-700',
          tono === 'exito' && 'text-emerald-700',
        )}
      >
        {valor}
      </p>
    </div>
  );
}

export function ListaAlertas({ alertas }: { alertas: SoporteResponse['alertas'] }) {
  if (!alertas.length) return null;
  return (
    <ul className="space-y-1">
      {alertas.map((a, i) => (
        <li key={i} className={cx('flex gap-2 text-sm', a.severidad === 'REVISION' ? 'text-amber-900' : 'text-slate-600')}>
          <span aria-hidden>{a.severidad === 'REVISION' ? '⚠' : 'ℹ'}</span>
          <span>
            {a.severidad === 'REVISION' && <span className="sr-only">Requiere revisión: </span>}
            {a.mensaje}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Vista previa del archivo (se descarga con el token; no se puede usar la URL directa). */
export function VistaArchivo({ legalizacionId, soporte, grande = false }: { legalizacionId: string; soporte: SoporteResponse; grande?: boolean }) {
  const api = useApi();
  const { data: blob } = useQuery({ ...archivoSoporteOptions(api, legalizacionId, soporte.id), enabled: !!soporte.archivo });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  if (!soporte.archivo) {
    return <div className={cx('flex items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500', grande ? 'h-64' : 'size-20')}>Sin foto</div>;
  }
  if (soporte.archivo.mime === 'application/pdf') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={cx('flex items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-marca-700', grande ? 'h-64' : 'size-20')}>
        PDF ↗
      </a>
    );
  }
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="block shrink-0">
      <img src={url} alt={`Factura: ${soporte.descripcion}`} className={cx('rounded-lg object-cover ring-1 ring-slate-200', grande ? 'max-h-[70vh] w-full object-contain' : 'size-20')} />
    </a>
  ) : (
    <div className={cx('animate-pulse rounded-lg bg-slate-100', grande ? 'h-64' : 'size-20')} />
  );
}

export function TarjetaSoporte({
  legalizacion,
  soporte: s,
  acciones,
  decidirLineas = false,
}: {
  legalizacion: LegalizacionResponse;
  soporte: SoporteResponse;
  acciones?: ReactNode;
  /** Contabilidad en revisión: puede excluir o aceptar líneas. */
  decidirLineas?: boolean;
}) {
  const conDetalle = s.datos?.lineas.some((l) => l.excluida || l.porVerificar) ?? false;
  return (
    <Tarjeta className={cx('space-y-3', s.requiereDecision && !s.decision && 'ring-2 ring-amber-300')}>
      <div className="flex flex-wrap gap-3 sm:flex-nowrap">
        <VistaArchivo legalizacionId={legalizacion.id} soporte={s} />
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Insignia tono={TONO_SOP[s.estado]}>{t(`estadoSoporte.${s.estado}`)}</Insignia>
            {s.tipo === 'RECIBO_CAJA' && <Insignia tono="info">Recibo de caja · 222</Insignia>}
            {s.datos && <Insignia>{t(`categoria.${s.datos.categoria}`)}</Insignia>}
          </div>
          <p className="font-medium text-slate-900">{s.datos?.emisorNombre ?? s.descripcion}</p>
          <p className="text-sm text-slate-600">
            {s.datos ? (
              <>
                {formatoFechaCalendario(s.datos.fecha)} · {formatoDinero(s.datos.total)} · {t(`medioPago.${s.datos.medioPago}`)}
                {s.datos.ultimos4Tarjeta && ` ··${s.datos.ultimos4Tarjeta}`}
              </>
            ) : (
              <>“{s.descripcion}”</>
            )}
          </p>
          {s.datos && <p className="text-sm text-slate-500">“{s.descripcion}”</p>}
        </div>
        {s.estado === 'CONFIRMADO' && (
          <div className="w-full border-t border-slate-100 pt-2 sm:w-auto sm:border-0 sm:pt-0 sm:text-right">
            <p className="font-semibold">{formatoDinero(s.montos.aceptado)}</p>
            {Number(s.montos.excluido.monto) > 0 && <p className="text-xs text-amber-800">− {formatoDinero(s.montos.excluido)} excluido</p>}
          </div>
        )}
      </div>
      {s.datos && (conDetalle || decidirLineas) && s.datos.lineas.length > 0 && (
        <LineasSoporte legalizacionId={legalizacion.id} soporteId={s.id} lineas={s.datos.lineas} decidir={decidirLineas} />
      )}
      <ListaAlertas alertas={s.alertas} />
      {s.decision && (
        <Alerta tono={s.decision.aplica ? 'exito' : 'peligro'}>
          Contabilidad: {s.decision.aplica ? 'aplica' : 'no aplica'} — {s.decision.contadorNombre}
          {s.decision.comentario && <> · “{s.decision.comentario}”</>}
        </Alerta>
      )}
      {acciones && <div className="flex flex-wrap justify-end gap-2">{acciones}</div>}
    </Tarjeta>
  );
}

export function HistorialLegalizacion({ historial }: { historial: LegalizacionResponse['historial'] }) {
  if (!historial.length) return null;
  return (
    <ol className="space-y-1 text-sm text-slate-600">
      {historial.map((h, i) => (
        <li key={i}>
          {formatoMomento(h.en)} · <strong>{t(`historial.${h.tipo}`)}</strong> por {h.usuarioNombre}
          {h.comentario && <> — “{h.comentario}”</>}
        </li>
      ))}
    </ol>
  );
}

export function EnlaceLegalizacion({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Link
      to="/legalizaciones/$legalizacionId"
      params={{ legalizacionId: id }}
      className="inline-flex min-h-11 items-center rounded-lg bg-marca-700 px-4 text-sm font-semibold text-white hover:bg-marca-800"
    >
      {children}
    </Link>
  );
}

type Linea = NonNullable<SoporteResponse['datos']>['lineas'][number];

/** Detalle de líneas: qué se excluyó (toda la línea o una parte) y qué queda por verificar. */
function LineasSoporte({ legalizacionId, soporteId, lineas, decidir }: { legalizacionId: string; soporteId: string; lineas: Linea[]; decidir: boolean }) {
  const decidirLinea = useDecidirLinea();
  const ocupada = (i: number) => decidirLinea.isPending && decidirLinea.variables?.soporteId === soporteId && decidirLinea.variables.indice === i;
  return (
    <div className="space-y-1">
      <ul className="divide-y divide-slate-100 rounded-lg bg-slate-50 text-sm">
        {lineas.map((l, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <span className={cx(l.excluida && Number(l.valorExcluido.monto) === Number(l.valor.monto) && 'line-through decoration-amber-700')}>{l.descripcion}</span>
              {l.tipo !== 'GASTO' && <span className="ml-2 text-xs text-slate-500">{l.tipo === 'IMPUESTO' ? 'impuesto' : 'propina'}</span>}
              {l.excluida && (
                <p className="text-xs text-amber-800">
                  Excluido {formatoDinero(l.valorExcluido)}
                  {l.motivoExclusion && ` · ${l.motivoExclusion}`}
                </p>
              )}
              {l.porVerificar && !l.decisionContable && <p className="text-xs font-semibold text-amber-800">Por verificar: {l.porVerificar}</p>}
              {l.decisionContable && l.porVerificar && (
                <p className="text-xs text-slate-500">Contabilidad: {l.decisionContable === 'EXCLUIR' ? 'excluida' : 'aceptada'}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium whitespace-nowrap">{formatoDinero(l.valor)}</span>
              {decidir && l.porVerificar && (
                <>
                  <Boton
                    variante={l.decisionContable === 'EXCLUIR' ? 'primario' : 'secundario'}
                    className="min-h-9 px-3 text-xs"
                    cargando={ocupada(i) && decidirLinea.variables?.excluir === true}
                    onClick={() => decidirLinea.mutate({ id: legalizacionId, soporteId, indice: i, excluir: true })}
                  >
                    Excluir
                  </Boton>
                  <Boton
                    variante={l.decisionContable === 'ACEPTAR' ? 'primario' : 'secundario'}
                    className="min-h-9 px-3 text-xs"
                    cargando={ocupada(i) && decidirLinea.variables?.excluir === false}
                    onClick={() => decidirLinea.mutate({ id: legalizacionId, soporteId, indice: i, excluir: false })}
                  >
                    Aceptar
                  </Boton>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {decidirLinea.error && <Alerta tono="peligro">{mensajeDeError(decidirLinea.error)}</Alerta>}
    </div>
  );
}
