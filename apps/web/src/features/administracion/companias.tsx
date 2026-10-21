import { useCompanias, useGuardarCompania, useSesion } from '@viaticos/client-app';
import type { Compania } from '@viaticos/contracts';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { opcionesDeMoneda } from '../../lib/monedas';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Cargando, Insignia, Tarjeta } from '../../ui/superficies';

type Datos = {
  name: string;
  legal_name: string;
  tax_id: string;
  country: string;
  currency: string;
  exchange_rate_policy: 'daily' | 'previous_month_close';
};

const POLITICAS: Record<Datos['exchange_rate_policy'], string> = {
  daily: 'Tasa del día de la factura',
  previous_month_close: 'Cierre del mes anterior a la factura',
};

const vacia: Datos = { name: '', legal_name: '', tax_id: '', country: 'CO', currency: 'COP', exchange_rate_policy: 'daily' };

/**
 * Compañías del grupo: la razón social y el NIT son los que deben ir en las facturas. La moneda es la local: en ella se
 * entregan y se legalizan los anticipos, aunque se calculen en la moneda del destino (decisiones 9.1 y 9.2).
 */
export function Companias() {
  const companias = useCompanias();
  const [editando, setEditando] = useState<{ id?: string; datos: Datos } | null>(null);

  if (companias.isPending) return <Cargando />;
  if (companias.isError) return <Alerta tono="peligro">{mensajeDeError(companias.error)}</Alerta>;

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200">
        {companias.data.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="font-medium">
                {c.name} {!c.active && <Insignia>Inactiva</Insignia>}
              </p>
              <p className="text-sm text-slate-500">
                {c.legal_name ?? '—'} · NIT {c.tax_id ?? '—'} · {c.country} · Moneda {c.currency}
              </p>
            </div>
            <Boton variante="fantasma" onClick={() => setEditando({ id: c.id, datos: aDatos(c) })}>
              Editar
            </Boton>
          </li>
        ))}
      </ul>
      {editando ? (
        <Formulario key={editando.id ?? 'nueva'} id={editando.id} inicial={editando.datos} alTerminar={() => setEditando(null)} />
      ) : (
        <Boton variante="secundario" onClick={() => setEditando({ datos: vacia })}>
          Nueva compañía
        </Boton>
      )}
    </div>
  );
}

function aDatos(c: Compania): Datos {
  return {
    name: c.name,
    legal_name: c.legal_name ?? '',
    tax_id: c.tax_id ?? '',
    country: c.country,
    currency: c.currency,
    exchange_rate_policy: c.exchange_rate_policy,
  };
}

function Formulario({ id, inicial, alTerminar }: { id?: string; inicial: Datos; alTerminar: () => void }) {
  const usuario = useSesion((s) => s.usuario);
  const guardar = useGuardarCompania();
  const [datos, setDatos] = useState(inicial);
  const cambiar = (campo: keyof Datos, valor: string) => setDatos({ ...datos, [campo]: valor });

  function enviar() {
    const comunes = {
      name: datos.name.trim(),
      legal_name: datos.legal_name.trim() || null,
      tax_id: datos.tax_id.trim() || null,
      country: datos.country.trim().toUpperCase(),
      currency: datos.currency,
    };
    guardar.mutate(
      id ? { id, datos: { ...comunes, exchange_rate_policy: datos.exchange_rate_policy } } : { datos: comunes },
      { onSuccess: alTerminar },
    );
  }

  return (
    <Tarjeta className="grid gap-4 sm:grid-cols-2">
      <h3 className="font-semibold sm:col-span-2">{id ? 'Editar compañía' : 'Nueva compañía'}</h3>
      <Campo etiqueta="Nombre">{(p) => <Entrada {...p} value={datos.name} onChange={(e) => cambiar('name', e.target.value)} />}</Campo>
      <Campo etiqueta="Razón social">{(p) => <Entrada {...p} value={datos.legal_name} onChange={(e) => cambiar('legal_name', e.target.value)} />}</Campo>
      <Campo etiqueta="NIT">{(p) => <Entrada {...p} value={datos.tax_id} onChange={(e) => cambiar('tax_id', e.target.value)} />}</Campo>
      <Campo etiqueta="País (código, ej. CO, MX, PA)">
        {(p) => <Entrada {...p} value={datos.country} maxLength={2} onChange={(e) => cambiar('country', e.target.value)} />}
      </Campo>
      <Campo
        etiqueta="Moneda local"
        ayuda={id ? 'Solo cambia los anticipos nuevos: los que ya existen siguen en su moneda.' : 'En ella se entregan y se legalizan los anticipos.'}
      >
        {(p) => (
          <Seleccion {...p} value={datos.currency} onChange={(e) => cambiar('currency', e.target.value)}>
            {opcionesDeMoneda(usuario, datos.currency).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Seleccion>
        )}
      </Campo>
      {id && (
        <Campo etiqueta="Tasa para las facturas en otra moneda" ayuda="Las pagadas en efectivo con un retiro usan la tasa del retiro">
          {(p) => (
            <Seleccion {...p} value={datos.exchange_rate_policy} onChange={(e) => cambiar('exchange_rate_policy', e.target.value)}>
              {Object.entries(POLITICAS).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
      )}
      {guardar.isError && (
        <div className="sm:col-span-2">
          <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Boton cargando={guardar.isPending} disabled={!datos.name.trim()} onClick={enviar}>
          {id ? 'Guardar' : 'Crear compañía'}
        </Boton>
        <Boton variante="fantasma" onClick={alTerminar}>
          Cancelar
        </Boton>
      </div>
    </Tarjeta>
  );
}
