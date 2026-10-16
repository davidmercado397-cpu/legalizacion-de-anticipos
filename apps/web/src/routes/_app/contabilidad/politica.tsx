import { zodResolver } from '@hookform/resolvers/zod';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { politicaLegalizacionOptions, useActualizarPolitica, useApi } from '@viaticos/client-app';
import { politicaLegalizacionSchema, type PoliticaLegalizacionRequest } from '@viaticos/contracts';
import { useFieldArray, useForm } from 'react-hook-form';
import { mensajeDeError } from '../../../lib/errores';
import { formatoMomento } from '../../../lib/formato';
import { Boton } from '../../../ui/boton';
import { AreaTexto, Campo, Entrada } from '../../../ui/campos';
import { Alerta, Cargando, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/contabilidad/politica')({
  beforeLoad: ({ context }) => {
    if (!context.sesion.getState().usuario?.roles.includes('CONTABILIDAD')) throw redirect({ to: '/solicitudes' });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(politicaLegalizacionOptions(context.api)),
  pendingComponent: () => <Cargando />,
  component: Politica,
});

/** En el formulario las palabras se editan como texto (una por línea o separadas por coma). */
type Formulario = Omit<PoliticaLegalizacionRequest, 'exclusiones'> & {
  exclusiones: Array<{ codigo: string; nombre: string; palabras: string; palabrasAmbiguas: string }>;
};

function Politica() {
  const api = useApi();
  const { data } = useSuspenseQuery(politicaLegalizacionOptions(api));
  const guardar = useActualizarPolitica();
  const { register, control, handleSubmit, setError, formState } = useForm<Formulario>({
    defaultValues: {
      ...data,
      exclusiones: data.exclusiones.map((e) => ({ ...e, palabras: e.palabras.join(', '), palabrasAmbiguas: e.palabrasAmbiguas.join(', ') })),
    },
  });
  const topes = useFieldArray({ control, name: 'topesReciboCaja' });
  const exclusiones = useFieldArray({ control, name: 'exclusiones' });

  const enviar = handleSubmit((f) => {
    const lista = (texto: string) => texto.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
    const datos = { ...f, exclusiones: f.exclusiones.map((e) => ({ ...e, palabras: lista(e.palabras), palabrasAmbiguas: lista(e.palabrasAmbiguas) })) };
    const validado = politicaLegalizacionSchema.safeParse(datos);
    if (!validado.success) {
      for (const issue of validado.error.issues) setError(issue.path.join('.') as never, { message: issue.message });
      return;
    }
    guardar.mutate(validado.data);
  });
  const e = formState.errors;

  return (
    <form noValidate onSubmit={enviar} className="space-y-5">
      <Link to="/contabilidad/configuracion" className="text-sm text-marca-700 hover:underline">
        ← Configuración
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Configuración de la legalización</h1>
        {data.actualizadaEn && <p className="text-sm text-slate-600">Última actualización: {formatoMomento(data.actualizadaEn)}</p>}
      </div>

      <Alerta tono="info">
        El NIT al que deben venir las facturas se configura por empresa en{' '}
        <Link to="/contabilidad/empresas" className="font-semibold underline">
          Empresas del holding
        </Link>
        .
      </Alerta>

      <Tarjeta className="space-y-3">
        <h2 className="text-lg font-semibold">Tope de recibos de caja (proveedor 222)</h2>
        {topes.fields.map((campo, i) => (
          <div key={campo.id} className="grid max-w-md grid-cols-[1fr_6rem_auto] items-end gap-2">
            <Campo etiqueta="Valor máximo por recibo" error={e.topesReciboCaja?.[i]?.monto?.message}>
              {(a11y) => <Entrada {...a11y} inputMode="decimal" {...register(`topesReciboCaja.${i}.monto`)} />}
            </Campo>
            <Campo etiqueta="Moneda" error={e.topesReciboCaja?.[i]?.moneda?.message}>
              {(a11y) => <Entrada {...a11y} maxLength={3} className="uppercase" {...register(`topesReciboCaja.${i}.moneda`)} />}
            </Campo>
            <Boton variante="fantasma" aria-label="Quitar tope" onClick={() => topes.remove(i)}>
              ✕
            </Boton>
          </div>
        ))}
        <Boton variante="secundario" onClick={() => topes.append({ monto: '', moneda: '' })}>
          + Agregar moneda
        </Boton>
      </Tarjeta>

      <Tarjeta className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Exclusiones</h2>
          <p className="text-sm text-slate-600">Las líneas de factura con estas palabras (en cualquier idioma) se excluyen y quedan a cargo del viajero.</p>
        </div>
        {exclusiones.fields.map((campo, i) => (
          <div key={campo.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
              <Campo etiqueta="Código">{(a11y) => <Entrada {...a11y} {...register(`exclusiones.${i}.codigo`)} />}</Campo>
              <Campo etiqueta="Nombre">{(a11y) => <Entrada {...a11y} {...register(`exclusiones.${i}.nombre`)} />}</Campo>
              <Boton variante="fantasma" className="text-red-700" onClick={() => exclusiones.remove(i)}>
                Quitar
              </Boton>
            </div>
            <Campo etiqueta="Palabras que excluyen (separadas por coma)">{(a11y) => <AreaTexto {...a11y} rows={2} {...register(`exclusiones.${i}.palabras`)} />}</Campo>
            <Campo etiqueta="Palabras ambiguas: la línea queda por verificar" ayuda='Palabras con otro sentido, como "margarita" (pizza o coctel).'>
              {(a11y) => <AreaTexto {...a11y} rows={2} {...register(`exclusiones.${i}.palabrasAmbiguas`)} />}
            </Campo>
          </div>
        ))}
        <Boton variante="secundario" onClick={() => exclusiones.append({ codigo: '', nombre: '', palabras: '', palabrasAmbiguas: '' })}>
          + Agregar exclusión
        </Boton>
      </Tarjeta>

      {guardar.isError && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
      {guardar.isSuccess && <Alerta tono="exito">Configuración guardada.</Alerta>}
      <div className="flex justify-end">
        <Boton type="submit" cargando={guardar.isPending}>
          Guardar configuración
        </Boton>
      </div>
    </form>
  );
}
