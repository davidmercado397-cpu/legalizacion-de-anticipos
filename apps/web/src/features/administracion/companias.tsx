import { useCompanias, useGuardarCompania } from '@viaticos/client-app';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Campo, Entrada } from '../../ui/campos';
import { Alerta, Cargando, Insignia, Tarjeta } from '../../ui/superficies';

/** Compañías del grupo: la razón social y el NIT son los que deben ir en las facturas. */
export function Companias() {
  const companias = useCompanias();
  const guardar = useGuardarCompania();
  const [nueva, setNueva] = useState<{ name: string; legal_name: string; tax_id: string; country: string; currency: string } | null>(null);

  if (companias.isPending) return <Cargando />;
  if (companias.isError) return <Alerta tono="peligro">{mensajeDeError(companias.error)}</Alerta>;

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-slate-200 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {companias.data.map((c) => (
          <li key={c.id} className="px-4 py-3">
            <p className="font-medium">
              {c.name} {!c.active && <Insignia>Inactiva</Insignia>}
            </p>
            <p className="text-sm text-slate-500">
              {c.legal_name ?? '—'} · NIT {c.tax_id ?? '—'} · {c.country} · {c.currency}
            </p>
          </li>
        ))}
      </ul>
      {nueva ? (
        <Tarjeta className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['name', 'Nombre'],
              ['legal_name', 'Razón social'],
              ['tax_id', 'NIT'],
              ['country', 'País (código, ej. CO)'],
              ['currency', 'Moneda (ej. COP)'],
            ] as const
          ).map(([campo, nombre]) => (
            <Campo key={campo} etiqueta={nombre}>
              {(p) => <Entrada {...p} value={nueva[campo]} onChange={(e) => setNueva({ ...nueva, [campo]: e.target.value })} />}
            </Campo>
          ))}
          {guardar.isError && (
            <div className="sm:col-span-2">
              <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Boton
              cargando={guardar.isPending}
              onClick={() =>
                guardar.mutate(
                  {
                    datos: {
                      name: nueva.name,
                      legal_name: nueva.legal_name || null,
                      tax_id: nueva.tax_id || null,
                      country: nueva.country.toUpperCase(),
                      currency: nueva.currency.toUpperCase(),
                    },
                  },
                  { onSuccess: () => setNueva(null) },
                )
              }
            >
              Crear compañía
            </Boton>
            <Boton variante="fantasma" onClick={() => setNueva(null)}>
              Cancelar
            </Boton>
          </div>
        </Tarjeta>
      ) : (
        <Boton variante="secundario" onClick={() => setNueva({ name: '', legal_name: '', tax_id: '', country: 'CO', currency: 'COP' })}>
          Nueva compañía
        </Boton>
      )}
    </div>
  );
}
