import { useCategorias, useDesactivarTarifa, useTarifas } from '@viaticos/client-app';
import type { ZonaViaje } from '@viaticos/contracts';
import { Plus, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { formatoDinero, formatoFechaCalendario } from '../../lib/formato';
import { Boton } from '../../ui/boton';
import { Campo, Seleccion } from '../../ui/campos';
import { EstadoConsulta } from '../../ui/estado-consulta';
import { Seccion } from '../../ui/pagina';
import { PanelLateral } from '../../ui/panel-lateral';
import { Alerta, EstadoVacio } from '../../ui/superficies';
import { Tabla } from '../../ui/tabla';
import { FormularioTarifa } from './formulario-tarifa';

/** Las tarifas vigentes por zona, tipo de personal y categoría; una nueva se crea en el panel lateral. */
export function ListaTarifas({ companiaId, zonas }: { companiaId: string; zonas: ZonaViaje[] }) {
  const tarifas = useTarifas(companiaId);
  const categorias = useCategorias(companiaId);
  const desactivar = useDesactivarTarifa(companiaId);
  const [zona, setZona] = useState('');
  const [nueva, setNueva] = useState(false);
  const nombreCategoria = (codigo: string) => categorias.data?.find((c) => c.code === codigo)?.name ?? codigo;
  const nombreZona = (id: string) => zonas.find((z) => z.id === id)?.name ?? '—';

  return (
    <Seccion
      titulo="Tarifas"
      {...(tarifas.data ? { contador: tarifas.data.length } : {})}
      acciones={
        zonas.length > 0 && (
          <Boton variante="secundario" tamano="pequeno" onClick={() => setNueva(true)}>
            <Plus aria-hidden />
            Nueva tarifa
          </Boton>
        )
      }
    >
      {zonas.length > 1 && (
        <Campo etiqueta="Zona">
          {(p) => (
            <Seleccion {...p} className="w-auto" value={zona} onChange={(e) => setZona(e.target.value)}>
              <option value="">Todas</option>
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
      )}
      {desactivar.isError && <Alerta tono="peligro">{mensajeDeError(desactivar.error)}</Alerta>}
      <EstadoConsulta consulta={tarifas}>
        {(todas) => {
          // Cada zona junta, y dentro de ella por tipo de personal y categoría: así se compara de un vistazo.
          const visibles = todas
            .filter((t) => !zona || t.zone_id === zona)
            .sort(
              (a, b) =>
                nombreZona(a.zone_id).localeCompare(nombreZona(b.zone_id), 'es') ||
                a.staff_type.localeCompare(b.staff_type) ||
                nombreCategoria(a.category_code).localeCompare(nombreCategoria(b.category_code), 'es'),
            );
          if (visibles.length === 0)
            return (
              <EstadoVacio titulo="No hay tarifas" icono={ReceiptText}>
                {zonas.length ? 'Agrégalas una por una o cárgalas desde Excel.' : 'Crea primero una zona.'}
              </EstadoVacio>
            );
          return (
            <Tabla
              columnas={[
                'Zona',
                'Personal',
                'Categoría',
                { titulo: 'Valor', numerica: true },
                { titulo: 'Vigencia', secundaria: true },
                { titulo: 'Acciones', oculta: true },
              ]}
              claves={visibles.map((t) => t.id)}
              filas={visibles.map((t) => [
                <span className="font-semibold text-slate-900">{nombreZona(t.zone_id)}</span>,
                etiqueta('personal', t.staff_type),
                nombreCategoria(t.category_code),
                <span>
                  {formatoDinero(t.amount, t.currency)} <span className="text-slate-500">{etiqueta('unidad', t.unit)}</span>
                </span>,
                <span className="whitespace-nowrap text-slate-600">
                  {formatoFechaCalendario(t.valid_from)} – {t.valid_to ? formatoFechaCalendario(t.valid_to) : 'sin fin'}
                </span>,
                <Boton
                  variante="fantasma"
                  tamano="pequeno"
                  cargando={desactivar.isPending && desactivar.variables === t.id}
                  onClick={() => desactivar.mutate(t.id)}
                >
                  Desactivar
                </Boton>,
              ])}
            />
          );
        }}
      </EstadoConsulta>
      <PanelLateral abierto={nueva} titulo="Nueva tarifa" alCerrar={() => setNueva(false)}>
        {nueva && <FormularioTarifa companiaId={companiaId} zonas={zonas} zonaInicial={zona} alTerminar={() => setNueva(false)} />}
      </PanelLateral>
    </Seccion>
  );
}
