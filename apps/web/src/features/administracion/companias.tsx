import { useCompanias, useGuardarCompania, useSesion } from '@viaticos/client-app';
import type { Compania } from '@viaticos/contracts';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { opcionesDeMoneda } from '../../lib/monedas';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { EstadoConsulta } from '../../ui/estado-consulta';
import { Seccion } from '../../ui/pagina';
import { PanelLateral } from '../../ui/panel-lateral';
import { Alerta, Esqueleto, Insignia } from '../../ui/superficies';
import { Tabla } from '../../ui/tabla';

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
  const cerrar = () => setEditando(null);

  return (
    <Seccion
      titulo="Compañías"
      {...(companias.data ? { contador: companias.data.length } : {})}
      acciones={
        <Boton variante="secundario" tamano="pequeno" onClick={() => setEditando({ datos: vacia })}>
          <Plus aria-hidden />
          Nueva compañía
        </Boton>
      }
    >
      <EstadoConsulta consulta={companias} cargando={<Esqueleto filas={2} />}>
        {(lista) => (
          <Tabla
            columnas={[
              'Compañía',
              { titulo: 'NIT', secundaria: true },
              { titulo: 'País', secundaria: true },
              'Moneda',
              { titulo: 'Acciones', oculta: true },
            ]}
            claves={lista.map((c) => c.id)}
            filas={lista.map((c) => [
              <span className="block min-w-0">
                <span className="flex items-center gap-2 font-semibold text-slate-900">
                  {c.name}
                  {!c.active && <Insignia tono="neutro">Inactiva</Insignia>}
                </span>
                <span className="block truncate text-slate-500">{c.legal_name ?? 'Sin razón social'}</span>
              </span>,
              c.tax_id ?? '—',
              c.country,
              c.currency,
              <Boton variante="secundario" tamano="pequeno" onClick={() => setEditando({ id: c.id, datos: aDatos(c) })}>
                Editar
              </Boton>,
            ])}
          />
        )}
      </EstadoConsulta>
      <PanelLateral
        abierto={editando !== null}
        titulo={editando?.id ? editando.datos.name || 'Compañía' : 'Nueva compañía'}
        descripcion="La razón social y el NIT son los que deben ir en las facturas."
        alCerrar={cerrar}
      >
        {editando && <Formulario key={editando.id ?? 'nueva'} id={editando.id} inicial={editando.datos} alTerminar={cerrar} />}
      </PanelLateral>
    </Seccion>
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
    <div className="space-y-4">
      <Campo etiqueta="Nombre">{(p) => <Entrada {...p} value={datos.name} onChange={(e) => cambiar('name', e.target.value)} />}</Campo>
      <Campo etiqueta="Razón social">{(p) => <Entrada {...p} value={datos.legal_name} onChange={(e) => cambiar('legal_name', e.target.value)} />}</Campo>
      <Campo etiqueta="NIT">{(p) => <Entrada {...p} value={datos.tax_id} onChange={(e) => cambiar('tax_id', e.target.value)} />}</Campo>
      <Campo etiqueta="País" ayuda="Código de dos letras: CO, MX, PA…">
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
      {guardar.isError && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
      <div className="flex gap-2">
        <Boton cargando={guardar.isPending} disabled={!datos.name.trim()} onClick={enviar}>
          {id ? 'Guardar cambios' : 'Crear compañía'}
        </Boton>
        <Boton variante="fantasma" onClick={alTerminar}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}
