import { zodResolver } from '@hookform/resolvers/zod';
import { useAccionEmpleado, useCompanias, useEmpleados, useGuardarEmpleado } from '@viaticos/client-app';
import type { Empleado, Rol, TipoPersonal } from '@viaticos/contracts';
import { KeyRound, Search, ShieldOff, UserCheck, UserPlus, UserX, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { etiqueta } from '../../i18n';
import { mensajeDeError } from '../../lib/errores';
import { useValorDiferido } from '../../lib/use-valor-diferido';
import { Boton } from '../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../ui/campos';
import { EstadoConsulta } from '../../ui/estado-consulta';
import { Seccion } from '../../ui/pagina';
import { PanelLateral } from '../../ui/panel-lateral';
import { Alerta, EstadoVacio, Insignia } from '../../ui/superficies';
import { Tabla } from '../../ui/tabla';
import { sinRechazo } from '../../lib/sin-rechazo';
import { ESTADO_WHATSAPP, Suplentes, WhatsApp, tieneSuplentes } from './detalle-usuario';

const ROLES: Rol[] = ['employee', 'approver', 'accountant', 'treasury', 'management', 'admin'];

const esquema = z.object({
  full_name: z.string().trim().min(2, 'validation.minLength'),
  email: z.string().trim().email('validation.email'),
  role: z.enum(['employee', 'approver', 'accountant', 'treasury', 'management', 'admin']),
  company_id: z.string().min(1, 'validation.required'),
  approver_id: z.string(),
  phone: z.string().trim(),
  staff_type: z.string(),
});
type Datos = z.infer<typeof esquema>;

type Estado = 'activos' | 'inactivos' | 'todos';
const ACTIVO: Record<Estado, boolean | undefined> = { activos: true, inactivos: false, todos: undefined };

/** Usuarios en tabla; al abrir uno, sus datos, acceso, WhatsApp y suplentes van en un panel a la derecha. */
export function Empleados() {
  const [busqueda, setBusqueda] = useState('');
  const buscar = useValorDiferido(busqueda, 300);
  const [rol, setRol] = useState<Rol | ''>('');
  const [estado, setEstado] = useState<Estado>('activos');
  const empleados = useEmpleados({ search: buscar || undefined, role: rol || undefined, active: ACTIVO[estado], limit: 200 });
  const aprobadores = useEmpleados({ limit: 200 });
  const [abierto, setAbierto] = useState<string | 'nuevo' | null>(null);
  const [claveTemporal, setClaveTemporal] = useState<{ email: string; clave: string } | null>(null);

  const todos = aprobadores.data?.data ?? [];
  const nombre = (id: string | null) => todos.find((e) => e.id === id)?.full_name;
  // El panel lee el usuario de la lista para ver al instante lo que cambió.
  const elegido =
    abierto && abierto !== 'nuevo'
      ? (empleados.data?.data.find((e) => e.id === abierto) ?? todos.find((e) => e.id === abierto))
      : undefined;

  return (
    <Seccion
      titulo="Usuarios"
      {...(empleados.data ? { contador: empleados.data.data.length } : {})}
      acciones={
        <Boton tamano="pequeno" onClick={() => setAbierto('nuevo')}>
          <UserPlus aria-hidden />
          Nuevo usuario
        </Boton>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Buscar" className="w-full sm:w-72">
          {(p) => (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <Entrada
                {...p}
                placeholder="Nombre o correo"
                className="pl-9"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
          )}
        </Campo>
        <Campo etiqueta="Rol">
          {(p) => (
            <Seleccion {...p} className="w-auto" value={rol} onChange={(e) => setRol(e.target.value as Rol | '')}>
              <option value="">Todos</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {etiqueta('rol', r)}
                </option>
              ))}
            </Seleccion>
          )}
        </Campo>
        <Campo etiqueta="Estado">
          {(p) => (
            <Seleccion {...p} className="w-auto" value={estado} onChange={(e) => setEstado(e.target.value as Estado)}>
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="todos">Todos</option>
            </Seleccion>
          )}
        </Campo>
      </div>

      {claveTemporal && <AvisoClave {...claveTemporal} alCerrar={() => setClaveTemporal(null)} />}

      <EstadoConsulta consulta={empleados}>
        {(pagina) =>
          pagina.data.length === 0 ? (
            <EstadoVacio titulo={buscar || rol ? 'Nadie coincide con la búsqueda' : 'Todavía no hay usuarios'} icono={Users} />
          ) : (
            <Tabla
              columnas={[
                'Nombre',
                'Rol',
                { titulo: 'Jefe inmediato', secundaria: true },
                { titulo: 'WhatsApp', secundaria: true },
                { titulo: 'Acciones', oculta: true },
              ]}
              claves={pagina.data.map((e) => e.id)}
              filas={pagina.data.map((e) => {
                const wa = ESTADO_WHATSAPP[e.wa_link_status];
                return [
                  <span className="block min-w-0">
                    <span className="flex items-center gap-2 font-semibold text-slate-900">
                      {e.full_name}
                      {!e.active && <Insignia tono="neutro">Inactivo</Insignia>}
                    </span>
                    <span className="block truncate text-slate-500">{e.email}</span>
                  </span>,
                  etiqueta('rol', e.role),
                  <span className="text-slate-600">{nombre(e.approver_id) ?? '—'}</span>,
                  <Insignia tono={wa.tono}>{e.wa_link_status === 'pending' ? 'Por confirmar' : wa.texto}</Insignia>,
                  <Boton variante="secundario" tamano="pequeno" onClick={() => setAbierto(e.id)}>
                    Abrir
                  </Boton>,
                ];
              })}
            />
          )
        }
      </EstadoConsulta>

      <PanelLateral
        abierto={abierto !== null}
        titulo={abierto === 'nuevo' ? 'Nuevo usuario' : (elegido?.full_name ?? 'Usuario')}
        descripcion={elegido && `${elegido.email} · ${etiqueta('rol', elegido.role)}`}
        alCerrar={() => setAbierto(null)}
      >
        {abierto === 'nuevo' && (
          <FormularioEmpleado
            empleado={null}
            aprobadores={todos.filter((e) => e.role !== 'employee' && e.active)}
            alTerminar={(clave, email) => {
              setAbierto(null);
              if (clave) setClaveTemporal({ clave, email });
            }}
          />
        )}
        {elegido && <FichaUsuario key={elegido.id} empleado={elegido} aprobadores={todos} />}
      </PanelLateral>
    </Seccion>
  );
}

function AvisoClave({ email, clave, alCerrar }: { email: string; clave: string; alCerrar?: () => void }) {
  return (
    <Alerta tono="exito" titulo="Contraseña temporal">
      Entrégala a {email} por un canal seguro: <code className="font-mono font-semibold">{clave}</code>. Deberá cambiarla al entrar.
      {alCerrar && (
        <div className="mt-2">
          <Boton variante="secundario" tamano="pequeno" onClick={alCerrar}>
            Ya la entregué
          </Boton>
        </div>
      )}
    </Alerta>
  );
}

/** Todo lo de un usuario en el panel: sus datos, su acceso, su WhatsApp y, si aprueba, sus suplentes. */
function FichaUsuario({ empleado: e, aprobadores }: { empleado: Empleado; aprobadores: Empleado[] }) {
  const accion = useAccionEmpleado();
  const [clave, setClave] = useState<string | null>(null);
  return (
    <>
      <FormularioEmpleado
        empleado={e}
        aprobadores={aprobadores.filter((a) => a.role !== 'employee' && a.active)}
        alTerminar={() => undefined}
      />
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900">Acceso</h3>
        <p className="text-sm text-slate-600">
          {e.mfa_enabled ? 'Tiene activa la verificación en dos pasos.' : 'Sin verificación en dos pasos.'}
          {e.must_change_password && ' Debe cambiar la contraseña al entrar.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Boton
            variante="secundario"
            tamano="pequeno"
            cargando={accion.isPending && accion.variables?.tipo === 'clave_temporal'}
            onClick={() => accion.mutate({ tipo: 'clave_temporal', id: e.id }, { onSuccess: (c) => c && setClave(c) })}
          >
            <KeyRound aria-hidden />
            Contraseña temporal
          </Boton>
          {e.mfa_enabled && (
            <Boton
              variante="secundario"
              tamano="pequeno"
              cargando={accion.isPending && accion.variables?.tipo === 'reiniciar_mfa'}
              onClick={() => accion.mutate({ tipo: 'reiniciar_mfa', id: e.id })}
            >
              <ShieldOff aria-hidden />
              Reiniciar verificación
            </Boton>
          )}
          <Boton
            variante="secundario"
            tamano="pequeno"
            cargando={accion.isPending && (accion.variables?.tipo === 'desactivar' || accion.variables?.tipo === 'activar')}
            onClick={() => accion.mutate({ tipo: e.active ? 'desactivar' : 'activar', id: e.id })}
          >
            {e.active ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
            {e.active ? 'Desactivar' : 'Activar'}
          </Boton>
        </div>
        {clave && <AvisoClave email={e.email} clave={clave} />}
        {accion.isError && <Alerta tono="peligro">{mensajeDeError(accion.error)}</Alerta>}
      </section>
      <WhatsApp empleado={e} />
      {tieneSuplentes(e) && <Suplentes empleado={e} aprobadores={aprobadores} />}
    </>
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
  const { register, handleSubmit, formState, reset } = useForm<Datos>({
    resolver: zodResolver(esquema),
    defaultValues: {
      full_name: empleado?.full_name ?? '',
      email: empleado?.email ?? '',
      role: (empleado?.role === 'superadmin' ? 'employee' : empleado?.role) ?? 'employee',
      company_id: empleado?.company_ids[0] ?? companias.data?.[0]?.id ?? '',
      approver_id: empleado?.approver_id ?? '',
      phone: empleado?.phone ?? '',
      staff_type: empleado?.staff_type ?? '',
    },
  });
  const e = formState.errors;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit(
        sinRechazo(async (d) => {
          const datos = {
            full_name: d.full_name,
            email: d.email,
            role: d.role,
            company_ids: [d.company_id],
            approver_id: d.approver_id || null,
            phone: d.phone || null,
            staff_type: (d.staff_type || null) as TipoPersonal | null,
          };
          const { claveTemporal } = await guardar.mutateAsync(empleado ? { id: empleado.id, datos } : { datos });
          reset(d);
          alTerminar(claveTemporal, d.email);
        }),
      )}
    >
      {empleado && <h3 className="text-sm font-bold text-slate-900">Datos</h3>}
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
      <Campo etiqueta="Tipo de personal" ayuda="Define qué tarifa de viaje le aplica">
        {(p) => (
          <Seleccion {...p} {...register('staff_type')}>
            <option value="">—</option>
            {(['administrative', 'operational'] satisfies TipoPersonal[]).map((t) => (
              <option key={t} value={t}>
                {etiqueta('personal', t)}
              </option>
            ))}
          </Seleccion>
        )}
      </Campo>
      <Campo etiqueta="Celular de WhatsApp" ayuda="Con indicativo, por ejemplo 573001234567">
        {(p) => <Entrada {...p} {...register('phone')} inputMode="tel" />}
      </Campo>
      {guardar.isError && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
      {guardar.isSuccess && empleado && !formState.isDirty && <Alerta tono="exito">Cambios guardados.</Alerta>}
      <Boton type="submit" cargando={guardar.isPending}>
        {empleado ? 'Guardar cambios' : 'Crear usuario'}
      </Boton>
    </form>
  );
}
