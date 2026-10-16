import { zodResolver } from '@hookform/resolvers/zod';
import { useAccionEmpleado, useCompanias, useEmpleados, useGuardarEmpleado } from '@viaticos/client-app';
import type { Empleado, Rol } from '@viaticos/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { useValorDiferido } from '../../lib/use-valor-diferido';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { Alerta, Cargando, Insignia, Tarjeta } from '../../ui/superficies';

const ROLES: Rol[] = ['employee', 'approver', 'accountant', 'treasury', 'admin'];

const esquema = z.object({
  full_name: z.string().trim().min(2, 'validation.minLength'),
  email: z.string().trim().email('validation.email'),
  role: z.enum(['employee', 'approver', 'accountant', 'treasury', 'admin']),
  company_id: z.string().min(1, 'validation.required'),
  approver_id: z.string(),
  phone: z.string().trim(),
});
type Datos = z.infer<typeof esquema>;

export function Empleados() {
  const [busqueda, setBusqueda] = useState('');
  const buscar = useValorDiferido(busqueda, 300);
  const empleados = useEmpleados({ search: buscar || undefined, limit: 200 });
  const aprobadores = useEmpleados({ limit: 200 });
  const [editando, setEditando] = useState<Empleado | 'nuevo' | null>(null);
  const accion = useAccionEmpleado();
  const [claveTemporal, setClaveTemporal] = useState<{ email: string; clave: string } | null>(null);

  const nombre = (id: string | null) => aprobadores.data?.data.find((e) => e.id === id)?.full_name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Entrada aria-label="Buscar usuario" placeholder="Buscar por nombre o correo" className="max-w-xs" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <Boton onClick={() => setEditando('nuevo')}>Nuevo usuario</Boton>
      </div>
      {claveTemporal && (
        <Alerta tono="exito" titulo="Contraseña temporal">
          Entréguela a {claveTemporal.email} por un canal seguro: <code className="font-mono">{claveTemporal.clave}</code>. Deberá cambiarla al
          entrar.
        </Alerta>
      )}
      {editando && (
        <FormularioEmpleado
          empleado={editando === 'nuevo' ? null : editando}
          aprobadores={(aprobadores.data?.data ?? []).filter((e) => e.role !== 'employee' && e.active)}
          alTerminar={(clave, email) => {
            setEditando(null);
            if (clave) setClaveTemporal({ clave, email });
          }}
        />
      )}
      {accion.isError && <Alerta tono="peligro">{mensajeDeError(accion.error)}</Alerta>}
      {empleados.isPending ? (
        <Cargando />
      ) : empleados.isError ? (
        <Alerta tono="peligro">{mensajeDeError(empleados.error)}</Alerta>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {empleados.data.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {e.full_name} {!e.active && <Insignia tono="neutro">Inactivo</Insignia>}
                </p>
                <p className="text-sm text-slate-500">
                  {e.email} · {etiqueta('rol', e.role)}
                  {e.approver_id && ` · aprueba ${nombre(e.approver_id) ?? '—'}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Boton variante="fantasma" onClick={() => setEditando(e)}>
                  Editar
                </Boton>
                <Boton
                  variante="fantasma"
                  onClick={() => accion.mutate({ tipo: 'clave_temporal', id: e.id }, { onSuccess: (clave) => clave && setClaveTemporal({ clave, email: e.email }) })}
                >
                  Contraseña temporal
                </Boton>
                {e.mfa_enabled && (
                  <Boton variante="fantasma" onClick={() => accion.mutate({ tipo: 'reiniciar_mfa', id: e.id })}>
                    Reiniciar verificación
                  </Boton>
                )}
                <Boton variante="fantasma" onClick={() => accion.mutate({ tipo: e.active ? 'desactivar' : 'activar', id: e.id })}>
                  {e.active ? 'Desactivar' : 'Activar'}
                </Boton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormularioEmpleado({
  empleado,
  aprobadores,
  alTerminar,
}: {
  empleado: Empleado | null;
  aprobadores: Empleado[];
  alTerminar: (claveTemporal: string | null, email: string) => void;
}) {
  const companias = useCompanias();
  const guardar = useGuardarEmpleado();
  const { register, handleSubmit, formState } = useForm<Datos>({
    resolver: zodResolver(esquema),
    defaultValues: {
      full_name: empleado?.full_name ?? '',
      email: empleado?.email ?? '',
      role: (empleado?.role === 'superadmin' ? 'employee' : empleado?.role) ?? 'employee',
      company_id: empleado?.company_ids[0] ?? companias.data?.[0]?.id ?? '',
      approver_id: empleado?.approver_id ?? '',
      phone: empleado?.phone ?? '',
    },
  });
  const e = formState.errors;
  return (
    <Tarjeta>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={handleSubmit(async (d) => {
          const datos = {
            full_name: d.full_name,
            email: d.email,
            role: d.role,
            company_ids: [d.company_id],
            approver_id: d.approver_id || null,
            phone: d.phone || null,
          };
          const { claveTemporal } = await guardar.mutateAsync(empleado ? { id: empleado.id, datos } : { datos });
          alTerminar(claveTemporal, d.email);
        })}
      >
        <h2 className="font-semibold sm:col-span-2">{empleado ? `Editar a ${empleado.full_name}` : 'Nuevo usuario'}</h2>
        <Campo etiqueta="Nombre completo" error={e.full_name?.message}>
          {(p) => <Entrada {...p} {...register('full_name')} />}
        </Campo>
        <Campo etiqueta="Correo" error={e.email?.message}>
          {(p) => <Entrada {...p} {...register('email')} type="email" />}
        </Campo>
        <Campo etiqueta="Rol">
          {(p) => (
            <Seleccion {...p} {...register('role')}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {etiqueta('rol', r)}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Compañía" error={e.company_id?.message}>
          {(p) => (
            <Seleccion {...p} {...register('company_id')}>
              {(companias.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Jefe inmediato (aprueba sus anticipos)">
          {(p) => (
            <Seleccion {...p} {...register('approver_id')}>
              <option value="">—</option>
              {aprobadores
                .filter((a) => a.id !== empleado?.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                  </option>
                ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Celular de WhatsApp" ayuda="Con indicativo, ej. 573001234567">
          {(p) => <Entrada {...p} {...register('phone')} inputMode="tel" />}
        </Campo>
        {guardar.isError && (
          <div className="sm:col-span-2">
            <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Boton type="submit" cargando={guardar.isPending}>
            Guardar
          </Boton>
          <Boton variante="fantasma" onClick={() => alTerminar(null, '')}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
