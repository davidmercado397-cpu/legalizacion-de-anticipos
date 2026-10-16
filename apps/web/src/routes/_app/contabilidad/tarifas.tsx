import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import {
  cargosOptions,
  conceptosOptions,
  tarifasOptions,
  useApi,
  useCerrarTarifa,
  useCrearTarifa,
  useGuardarConcepto,
} from '@viaticos/client-app';
import { conceptoSchema, tarifaRequestSchema, type ConceptoRequest, type TarifaRequest, type TarifaResponse } from '@viaticos/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { mensajeDeError } from '../../../lib/errores';
import { hoyLocal } from '../../../lib/fechas';
import { formatoDinero, formatoFechaCalendario, nombrePais } from '../../../lib/formato';
import { exigirRol } from '../../../lib/roles';
import { Boton } from '../../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../../ui/campos';
import { Alerta, Cargando, EstadoVacio, Insignia, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/contabilidad/tarifas')({
  beforeLoad: ({ context }) => exigirRol(context.sesion, 'CONTABILIDAD'),
  loader: ({ context }) =>
    Promise.all([context.queryClient.ensureQueryData(conceptosOptions(context.api)), context.queryClient.ensureQueryData(cargosOptions(context.api))]),
  pendingComponent: () => <Cargando />,
  component: Tarifas,
});

function Tarifas() {
  const api = useApi();
  const { data: conceptos } = useSuspenseQuery(conceptosOptions(api));
  const { data: cargos } = useSuspenseQuery(cargosOptions(api));
  const [cargoId, setCargoId] = useState(cargos[0]?.codigo ?? '');
  const [paisCodigo, setPaisCodigo] = useState('');
  const filtro = { cargoId, ...(paisCodigo.length === 2 && { paisCodigo: paisCodigo.toUpperCase() }) };
  const tarifas = useQuery(tarifasOptions(api, filtro));
  const nombreConcepto = (codigo: string) => conceptos.find((c) => c.codigo === codigo)?.nombre ?? codigo;

  // Agrupadas por país, las vigentes primero.
  const hoy = hoyLocal();
  const porPais = new Map<string, TarifaResponse[]>();
  for (const t of tarifas.data ?? []) porPais.set(t.paisCodigo, [...(porPais.get(t.paisCodigo) ?? []), t]);

  return (
    <div className="space-y-5">
      <Link to="/contabilidad/configuracion" className="text-sm text-marca-700 hover:underline">
        ← Configuración
      </Link>
      <h1 className="text-2xl font-bold">Conceptos y tarifas</h1>

      <Conceptos />

      <Tarjeta className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Tarifas por cargo y país</h2>
          <p className="text-sm text-slate-600">
            Una tarifa nueva para el mismo cargo, país y concepto reemplaza la anterior desde su fecha de inicio; el historial se conserva.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Cargo">
            {(a11y) => (
              <Seleccion {...a11y} value={cargoId} onChange={(e) => setCargoId(e.target.value)}>
                {cargos.map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.nombre}
                  </option>
                ))}
              </Seleccion>
            )}
          </Campo>
          <Campo etiqueta="País (código, opcional)" ayuda="CO, BR, US…">
            {(a11y) => <Entrada {...a11y} maxLength={2} className="uppercase" value={paisCodigo} onChange={(e) => setPaisCodigo(e.target.value)} />}
          </Campo>
        </div>
        {tarifas.isPending ? (
          <Cargando />
        ) : porPais.size === 0 ? (
          <EstadoVacio titulo="No hay tarifas para este filtro" />
        ) : (
          [...porPais.entries()].map(([pais, lista]) => (
            <section key={pais} className="space-y-1">
              <h3 className="font-semibold">
                {nombrePais(pais)} ({pais})
              </h3>
              <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {lista.map((t) => {
                  const vigente = t.vigenteDesde <= hoy && (!t.vigenteHasta || t.vigenteHasta >= hoy);
                  return (
                    <FilaTarifa key={t.id} tarifa={t} concepto={nombreConcepto(t.conceptoCodigo)} vigente={vigente} />
                  );
                })}
              </ul>
            </section>
          ))
        )}
        <NuevaTarifa cargoId={cargoId} conceptos={conceptos.filter((c) => c.activo)} />
      </Tarjeta>
    </div>
  );
}

function FilaTarifa({ tarifa: t, concepto, vigente }: { tarifa: TarifaResponse; concepto: string; vigente: boolean }) {
  const cerrar = useCerrarTarifa();
  const [hasta, setHasta] = useState<string | null>(null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
      <div>
        <span className="font-medium">{concepto}</span> · {formatoDinero(t.valor)}
        <p className="text-xs text-slate-500">
          Desde {formatoFechaCalendario(t.vigenteDesde)}
          {t.vigenteHasta ? ` hasta ${formatoFechaCalendario(t.vigenteHasta)}` : ' · sin fecha de fin'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {vigente ? <Insignia tono="exito">Vigente</Insignia> : <Insignia>No vigente</Insignia>}
        {!t.vigenteHasta &&
          (hasta === null ? (
            <Boton variante="fantasma" className="min-h-9 px-2 text-xs" onClick={() => setHasta(hoyLocal())}>
              Terminar vigencia
            </Boton>
          ) : (
            <>
              <input type="date" aria-label="Vigente hasta" className="min-h-9 rounded border border-slate-300 px-2" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              <Boton className="min-h-9 px-3 text-xs" cargando={cerrar.isPending} onClick={() => cerrar.mutate({ id: t.id, vigenteHasta: hasta })}>
                Confirmar
              </Boton>
            </>
          ))}
        {cerrar.error && <span className="text-xs text-red-700">{mensajeDeError(cerrar.error)}</span>}
      </div>
    </li>
  );
}

function NuevaTarifa({ cargoId, conceptos }: { cargoId: string; conceptos: ConceptoRequest[] }) {
  const crear = useCrearTarifa();
  const { register, handleSubmit, formState, reset } = useForm<TarifaRequest>({
    resolver: zodResolver(tarifaRequestSchema),
    values: { cargoId, paisCodigo: '', conceptoCodigo: conceptos[0]?.codigo ?? '', valor: '', moneda: 'USD', vigenteDesde: hoyLocal(), vigenteHasta: '' },
  });
  const e = formState.errors;
  return (
    <form
      noValidate
      onSubmit={handleSubmit((d) => crear.mutate(d, { onSuccess: () => reset() }))}
      className="space-y-3 rounded-lg bg-slate-50 p-3"
    >
      <h3 className="font-semibold">Nueva tarifa para este cargo</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="País (código)" error={e.paisCodigo?.message}>
          {(a11y) => <Entrada {...a11y} maxLength={2} className="uppercase" {...register('paisCodigo')} error={e.paisCodigo?.message} />}
        </Campo>
        <Campo etiqueta="Concepto" error={e.conceptoCodigo?.message}>
          {(a11y) => (
            <Seleccion {...a11y} {...register('conceptoCodigo')}>
              {conceptos.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.nombre}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Campo etiqueta="Valor por día/noche" error={e.valor?.message}>
            {(a11y) => <Entrada {...a11y} inputMode="decimal" {...register('valor')} error={e.valor?.message} />}
          </Campo>
          <Campo etiqueta="Moneda" error={e.moneda?.message}>
            {(a11y) => <Entrada {...a11y} maxLength={3} className="uppercase" {...register('moneda')} />}
          </Campo>
        </div>
        <Campo etiqueta="Vigente desde" error={e.vigenteDesde?.message}>
          {(a11y) => <Entrada {...a11y} type="date" {...register('vigenteDesde')} />}
        </Campo>
        <Campo etiqueta="Vigente hasta (opcional)" error={e.vigenteHasta?.message}>
          {(a11y) => <Entrada {...a11y} type="date" {...register('vigenteHasta')} />}
        </Campo>
      </div>
      {crear.error && <Alerta tono="peligro">{mensajeDeError(crear.error)}</Alerta>}
      {crear.isSuccess && <Alerta tono="exito">Tarifa creada.</Alerta>}
      <div className="flex justify-end">
        <Boton type="submit" cargando={crear.isPending}>
          Crear tarifa
        </Boton>
      </div>
    </form>
  );
}

function Conceptos() {
  const api = useApi();
  const { data } = useSuspenseQuery(conceptosOptions(api));
  const guardar = useGuardarConcepto();
  const { register, handleSubmit, formState, reset } = useForm<ConceptoRequest>({
    resolver: zodResolver(conceptoSchema),
    defaultValues: { codigo: '', nombre: '', unidad: 'DIA', activo: true },
  });
  const e = formState.errors;
  return (
    <Tarjeta className="space-y-3">
      <h2 className="text-lg font-semibold">Conceptos de viático</h2>
      <ul className="flex flex-wrap gap-2">
        {data.map((c) => (
          <li key={c.codigo} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm ring-1 ring-slate-200">
            <span className={c.activo ? '' : 'text-slate-400 line-through'}>{c.nombre}</span>
            <span className="text-xs text-slate-500">por {c.unidad === 'NOCHE' ? 'noche' : 'día'}</span>
            <button
              type="button"
              className="text-xs font-semibold text-marca-700 hover:underline"
              onClick={() => guardar.mutate({ ...c, activo: !c.activo })}
            >
              {c.activo ? 'Desactivar' : 'Activar'}
            </button>
          </li>
        ))}
      </ul>
      <form noValidate onSubmit={handleSubmit((d) => guardar.mutate(d, { onSuccess: () => reset() }))} className="grid gap-3 sm:grid-cols-[1fr_2fr_8rem_auto] sm:items-end">
        <Campo etiqueta="Código" error={e.codigo?.message}>
          {(a11y) => <Entrada {...a11y} className="uppercase" placeholder="LAVANDERIA" {...register('codigo')} error={e.codigo?.message} />}
        </Campo>
        <Campo etiqueta="Nombre" error={e.nombre?.message}>
          {(a11y) => <Entrada {...a11y} placeholder="Lavandería" {...register('nombre')} error={e.nombre?.message} />}
        </Campo>
        <Campo etiqueta="Se paga por">
          {(a11y) => (
            <Seleccion {...a11y} {...register('unidad')}>
              <option value="DIA">Día</option>
              <option value="NOCHE">Noche</option>
            </Seleccion>
          )}
        </Campo>
        <Boton type="submit" cargando={guardar.isPending}>
          Agregar
        </Boton>
      </form>
      {guardar.error && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
    </Tarjeta>
  );
}
