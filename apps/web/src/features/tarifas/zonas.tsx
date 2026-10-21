import { useGuardarZona } from '@viaticos/client-app';
import type { ZonaViaje } from '@viaticos/contracts';
import { MapPin, Plus } from 'lucide-react';
import { useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Campo, Entrada } from '../../ui/campos';
import { Seccion } from '../../ui/pagina';
import { PanelLateral } from '../../ui/panel-lateral';
import { Alerta, EstadoVacio, Insignia } from '../../ui/superficies';
import { Tabla } from '../../ui/tabla';

const lugares = (texto: string) =>
  texto
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

/** Ciudades o países que comparten tarifas; se editan en el panel lateral. */
export function Zonas({ companiaId, zonas }: { companiaId: string; zonas: ZonaViaje[] }) {
  const guardar = useGuardarZona(companiaId);
  const [editando, setEditando] = useState<ZonaViaje | 'nueva' | null>(null);
  const cerrar = () => setEditando(null);

  return (
    <Seccion
      titulo="Zonas"
      contador={zonas.length}
      acciones={
        <Boton variante="secundario" tamano="pequeno" onClick={() => setEditando('nueva')}>
          <Plus aria-hidden />
          Nueva zona
        </Boton>
      }
    >
      <p className="-mt-1 max-w-prose text-sm text-slate-600">
        Ciudades o países (código ISO, por ejemplo BR) que comparten tarifas. Si un destino coincide con varias zonas, gana la más
        específica.
      </p>
      {guardar.isError && editando === null && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
      {zonas.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay zonas"
          icono={MapPin}
          accion={
            <Boton variante="secundario" onClick={() => setEditando('nueva')}>
              <Plus aria-hidden />
              Crear la primera zona
            </Boton>
          }
        >
          Sin zonas no se puede calcular el valor de los anticipos.
        </EstadoVacio>
      ) : (
        <Tabla
          columnas={['Zona', { titulo: 'Lugares', secundaria: true }, { titulo: 'Acciones', oculta: true }]}
          claves={zonas.map((z) => z.id)}
          filas={zonas.map((z) => [
            <span className="flex items-center gap-2 font-semibold text-slate-900">
              {z.name}
              {!z.active && <Insignia>Inactiva</Insignia>}
            </span>,
            <span className="text-slate-600">{z.places.join(', ') || 'Sin lugares'}</span>,
            <span className="flex justify-end gap-2">
              <Boton variante="secundario" tamano="pequeno" onClick={() => setEditando(z)}>
                Editar
              </Boton>
              <Boton
                variante="fantasma"
                tamano="pequeno"
                disabled={guardar.isPending}
                onClick={() => guardar.mutate({ id: z.id, datos: { active: !z.active } })}
              >
                {z.active ? 'Desactivar' : 'Activar'}
              </Boton>
            </span>,
          ])}
        />
      )}
      <PanelLateral abierto={editando !== null} titulo={editando === 'nueva' ? 'Nueva zona' : (editando?.name ?? 'Zona')} alCerrar={cerrar}>
        {editando && (
          <FormularioZona
            key={editando === 'nueva' ? 'nueva' : editando.id}
            zona={editando === 'nueva' ? null : editando}
            cargando={guardar.isPending}
            error={guardar.isError ? mensajeDeError(guardar.error) : null}
            alGuardar={(nombre, lista) =>
              guardar.mutate(
                { id: editando === 'nueva' ? undefined : editando.id, datos: { name: nombre, places: lista } },
                { onSuccess: cerrar },
              )
            }
            alCancelar={cerrar}
          />
        )}
      </PanelLateral>
    </Seccion>
  );
}

function FormularioZona({
  zona,
  cargando,
  error,
  alGuardar,
  alCancelar,
}: {
  zona: ZonaViaje | null;
  cargando: boolean;
  error: string | null;
  alGuardar: (nombre: string, lugares: string[]) => void;
  alCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(zona?.name ?? '');
  const [texto, setTexto] = useState(zona?.places.join(', ') ?? '');
  return (
    <div className="space-y-4">
      <Campo etiqueta="Nombre de la zona">
        {(p) => (
          <Entrada {...p} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Por ejemplo Ciudades principales" />
        )}
      </Campo>
      <Campo etiqueta="Lugares" ayuda="Separados por coma">
        {(p) => <Entrada {...p} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Bogotá, Medellín, Cali" />}
      </Campo>
      {error && <Alerta tono="peligro">{error}</Alerta>}
      <div className="flex gap-2">
        <Boton cargando={cargando} disabled={nombre.trim().length < 2} onClick={() => alGuardar(nombre.trim(), lugares(texto))}>
          {zona ? 'Guardar cambios' : 'Crear zona'}
        </Boton>
        <Boton variante="fantasma" onClick={alCancelar}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}
