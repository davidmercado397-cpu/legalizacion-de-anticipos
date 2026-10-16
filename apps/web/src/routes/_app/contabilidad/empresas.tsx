import { zodResolver } from '@hookform/resolvers/zod';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { empresasOptions, useApi, useGuardarEmpresa } from '@viaticos/client-app';
import { empresaRequestSchema, type EmpresaRequest, type EmpresaResponse } from '@viaticos/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { mensajeDeError } from '../../../lib/errores';
import { exigirRol } from '../../../lib/roles';
import { Boton } from '../../../ui/boton';
import { Campo, Entrada } from '../../../ui/campos';
import { Alerta, Cargando, Insignia, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/contabilidad/empresas')({
  beforeLoad: ({ context }) => exigirRol(context.sesion, 'CONTABILIDAD', 'ADMIN'),
  loader: ({ context }) => context.queryClient.ensureQueryData(empresasOptions(context.api)),
  pendingComponent: () => <Cargando />,
  component: Empresas,
});

function Empresas() {
  const api = useApi();
  const { data } = useSuspenseQuery(empresasOptions(api));
  const [editando, setEditando] = useState<EmpresaResponse | 'nueva' | null>(null);

  return (
    <div className="space-y-4">
      <Link to="/contabilidad/configuracion" className="text-sm text-marca-700 hover:underline">
        ← Configuración
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Empresas del holding</h1>
          <p className="text-sm text-slate-600">Las facturas de cada empleado deben venir al NIT de su empresa.</p>
        </div>
        <Boton onClick={() => setEditando('nueva')}>+ Nueva empresa</Boton>
      </div>
      {editando === 'nueva' && <FormularioEmpresa empresa={null} alTerminar={() => setEditando(null)} />}
      <ul className="space-y-2">
        {data.map((e) =>
          editando !== 'nueva' && editando?.id === e.id ? (
            <li key={e.id}>
              <FormularioEmpresa empresa={e} alTerminar={() => setEditando(null)} />
            </li>
          ) : (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
              <div>
                <p className="font-medium">{e.nombre}</p>
                <p className="text-sm text-slate-600">NIT {e.nit}</p>
              </div>
              <div className="flex items-center gap-2">
                {!e.activa && <Insignia>Inactiva</Insignia>}
                <Boton variante="secundario" onClick={() => setEditando(e)}>
                  Editar
                </Boton>
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function FormularioEmpresa({ empresa, alTerminar }: { empresa: EmpresaResponse | null; alTerminar: () => void }) {
  const guardar = useGuardarEmpresa();
  const { register, handleSubmit, formState } = useForm<EmpresaRequest>({
    resolver: zodResolver(empresaRequestSchema),
    defaultValues: empresa ?? { nombre: '', nit: '', activa: true },
  });
  const e = formState.errors;
  return (
    <Tarjeta>
      <form noValidate onSubmit={handleSubmit((datos) => guardar.mutate({ id: empresa?.id ?? null, datos }, { onSuccess: alTerminar }))} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Campo etiqueta="Razón social" error={e.nombre?.message}>
            {(a11y) => <Entrada {...a11y} {...register('nombre')} error={e.nombre?.message} />}
          </Campo>
          <Campo etiqueta="NIT (sin dígito de verificación)" error={e.nit?.message}>
            {(a11y) => <Entrada {...a11y} inputMode="numeric" {...register('nit')} error={e.nit?.message} />}
          </Campo>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" {...register('activa')} /> Activa
        </label>
        {guardar.error && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={alTerminar}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={guardar.isPending}>
            Guardar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
