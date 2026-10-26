import { useCategorias, useCrearTarifa, useSesion } from '@viaticos/client-app';
import type { TipoPersonal, UnidadTarifa, ZonaViaje } from '@viaticos/contracts';
import { useState } from 'react';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { hoyLocal } from '../../lib/fechas';
import { opcionesDeMoneda } from '../../lib/monedas';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta } from '../../ui/superficies';

const TIPOS: TipoPersonal[] = ['administrative', 'operational'];
const UNIDADES: UnidadTarifa[] = ['per_day', 'per_night', 'per_trip', 'per_15_days'];

export function FormularioTarifa({
  companiaId,
  zonas,
  zonaInicial,
  alTerminar,
}: {
  companiaId: string;
  zonas: ZonaViaje[];
  zonaInicial: string;
  alTerminar: () => void;
}) {
  const usuario = useSesion((s) => s.usuario);
  const categorias = useCategorias(companiaId);
  const crear = useCrearTarifa(companiaId);
  const [datos, setDatos] = useState({
    zone_id: zonaInicial || zonas[0]?.id || '',
    staff_type: 'administrative' as TipoPersonal,
    category_code: '',
    amount: '',
    currency: 'COP',
    unit: 'per_day' as UnidadTarifa,
    valid_from: hoyLocal(),
    valid_to: '',
  });
  const cambiar = (cambios: Partial<typeof datos>) => setDatos((d) => ({ ...d, ...cambios }));
  const completo = datos.zone_id && datos.category_code && Number(datos.amount.replace(',', '.')) > 0 && datos.valid_from;

  return (
    <div className="space-y-4">
      <Campo etiqueta="Zona">
        {(p) => (
          <Seleccion {...p} value={datos.zone_id} onChange={(e) => cambiar({ zone_id: e.target.value })}>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Seleccion>
        )}
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Tipo de personal">
          {(p) => (
            <Seleccion {...p} value={datos.staff_type} onChange={(e) => cambiar({ staff_type: e.target.value as TipoPersonal })}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {etiqueta('personal', t)}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Categoría">
          {(p) => (
            <Seleccion {...p} value={datos.category_code} onChange={(e) => cambiar({ category_code: e.target.value })}>
              <option value="">—</option>
              {(categorias.data ?? [])
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.emoji} {c.name}
                  </option>
                ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Valor">
          {(p) => (
            <Entrada
              {...p}
              inputMode="decimal"
              className="text-right tabular-nums"
              value={datos.amount}
              onChange={(e) => cambiar({ amount: e.target.value })}
            />
          )}
        </Campo>
        <Campo etiqueta="Moneda">
          {(p) => (
            <Seleccion {...p} value={datos.currency} onChange={(e) => cambiar({ currency: e.target.value })}>
              {opcionesDeMoneda(usuario, datos.currency).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Unidad">
          {(p) => (
            <Seleccion {...p} value={datos.unit} onChange={(e) => cambiar({ unit: e.target.value as UnidadTarifa })}>
              {UNIDADES.map((u) => (
                <option key={u} value={u}>
                  {etiqueta('unidad', u)}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <span className="hidden sm:block" />
        <Campo etiqueta="Desde">
          {(p) => <Entrada {...p} type="date" value={datos.valid_from} onChange={(e) => cambiar({ valid_from: e.target.value })} />}
        </Campo>
        <Campo etiqueta="Hasta" ayuda="Vacío = sin fin">
          {(p) => <Entrada {...p} type="date" value={datos.valid_to} onChange={(e) => cambiar({ valid_to: e.target.value })} />}
        </Campo>
      </div>
      {crear.isError && <Alerta tono="peligro">{mensajeDeError(crear.error)}</Alerta>}
      <div className="flex gap-2">
        <Boton
          cargando={crear.isPending}
          disabled={!completo}
          onClick={() =>
            crear.mutate(
              { ...datos, amount: datos.amount.replace(/\./g, '').replace(',', '.'), valid_to: datos.valid_to || null },
              { onSuccess: alTerminar },
            )
          }
        >
          Crear tarifa
        </Boton>
        <Boton variante="fantasma" onClick={alTerminar}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}
