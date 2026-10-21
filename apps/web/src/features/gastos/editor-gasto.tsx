import { useDescartarGasto, useSesion } from '@viaticos/client-app';
import type { AnticipoDetalle, GastoDetalle } from '@viaticos/contracts';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { puede } from '../../lib/roles';
import { Boton } from '../../ui/boton';
import { Alerta, Insignia } from '../../ui/superficies';
import { pendienteDe } from './componentes';
import { TarjetaDeducibilidad } from './deducibilidad';
import { AvisosGasto } from './editor-avisos';
import { FormularioGasto } from './editor-formulario';
import { LineasGasto } from './editor-lineas';
import { ResumenGasto } from './editor-resumen';
import { RevisionGasto } from './editor-revision';
import { VisorFactura } from './visor-factura';

/** La factura a la izquierda, fija; a la derecha lo que hay que saber, los datos y lo que sigue. */
export function EditorGasto({ anticipo, gasto }: { anticipo: AnticipoDetalle; gasto: GastoDetalle }) {
  const usuario = useSesion((s) => s.usuario);
  const propio = usuario?.id === gasto.employee_id;
  const editable = propio && anticipo.status === 'approved' && ['extracted', 'failed', 'confirmed'].includes(gasto.status);
  // Mientras la IA la lee (o la reintenta) no se edita, pero sí se puede descartar: una foto equivocada no debe esperar.
  const enLectura = propio && anticipo.status === 'approved' && ['received', 'processing', 'unreadable'].includes(gasto.status);
  const revisa = !propio && puede(usuario, 'contabilidad') && anticipo.status === 'in_review';
  // Tras confirmar, la siguiente que el usuario puede resolver en el mismo anticipo.
  const siguiente = anticipo.expenses.find((g) => g.id !== gasto.id && g.status !== 'discarded' && pendienteDe(g)?.accion);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-3 lg:sticky lg:top-8 lg:self-start">
        <VisorFactura gasto={gasto} />
        {gasto.review_status !== 'not_required' && (
          <Insignia tono={gasto.review_status === 'pending' ? 'aviso' : 'neutro'}>{etiqueta('revision', gasto.review_status)}</Insignia>
        )}
        {enLectura && <BotonDescartar gastoId={gasto.id} />}
      </div>
      <div className="min-w-0 space-y-10">
        <AvisosGasto anticipo={anticipo} gasto={gasto} />
        {editable ? (
          <FormularioGasto anticipo={anticipo} gasto={gasto} {...(siguiente ? { siguiente } : {})} />
        ) : (
          <ResumenGasto gasto={gasto} />
        )}
        <LineasGasto gasto={gasto} companiaId={anticipo.company_id} editable={editable || revisa} />
        {revisa && (gasto.review_status === 'pending' || gasto.status === 'confirmed') && <RevisionGasto gasto={gasto} />}
        {!propio && puede(usuario, 'contabilidad') && gasto.status === 'confirmed' && <TarjetaDeducibilidad gasto={gasto} />}
      </div>
    </div>
  );
}

function BotonDescartar({ gastoId }: { gastoId: string }) {
  const descartar = useDescartarGasto();
  return (
    <div className="space-y-2">
      <Boton variante="secundario" cargando={descartar.isPending} onClick={() => descartar.mutate(gastoId)}>
        Descartar esta factura
      </Boton>
      {descartar.isError && <Alerta tono="peligro">{mensajeDeError(descartar.error)}</Alerta>}
    </div>
  );
}
