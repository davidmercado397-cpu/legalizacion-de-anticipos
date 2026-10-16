import { zodResolver } from '@hookform/resolvers/zod';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import {
  cargosOptions,
  empresasOptions,
  useApi,
  useAsignarContrasena,
  useGuardarCargo,
  useGuardarUsuario,
  usuariosAdminOptions,
} from '@viaticos/client-app';
import { ROLES, cargoSchema, usuarioRequestSchema, type CargoRequest, type UsuarioAdminResponse, type UsuarioRequest } from '@viaticos/contracts';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { mensajeDeError } from '../../../lib/errores';
import { exigirRol } from '../../../lib/roles';
import { Boton } from '../../../ui/boton';
import { Campo, Entrada, Seleccion } from '../../../ui/campos';
import { Alerta, Cargando, Insignia, Tarjeta } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/administracion/')({
  beforeLoad: ({ context }) => exigirRol(context.sesion, 'ADMIN'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(usuariosAdminOptions(context.api)),
      context.queryClient.ensureQueryData(empresasOptions(context.api)),
      context.queryClient.ensureQueryData(cargosOptions(context.api)),
    ]),
  pendingComponent: () => <Cargando />,
  component: Administracion,
});

const NOMBRE_ROL: Record<(typeof ROLES)[number], string> = {
  VIAJERO: 'Viajero',
  APROBADOR: 'Aprobador',
  GERENCIA: 'Gerencia',
  TESORERIA: 'Tesorería',
  CONTABILIDAD: 'Contabilidad',
  ADMIN: 'Administrador',
};

function Administracion() {
  const api = useApi();
  const { data: usuarios } = useSuspenseQuery(usuariosAdminOptions(api));
  const { data: empresas } = useSuspenseQuery(empresasOptions(api));
  const { data: cargos } = useSuspenseQuery(cargosOptions(api));
  const [editando, setEditando] = useState<UsuarioAdminResponse | 'nuevo' | null>(null);
  const [filtro, setFiltro] = useState('');
  const nombre = useMemo(() => new Map(usuarios.map((u) => [u.id, u.nombre])), [usuarios]);
  const visibles = usuarios.filter((u) => `${u.nombre} ${u.email}`.toLowerCase().includes(filtro.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="text-sm text-slate-600">Cree los usuarios, asígneles empresa, cargo, jefes y roles, y entrégueles una contraseña inicial.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/contabilidad/empresas" className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-marca-700 ring-1 ring-marca-600 hover:bg-marca-50">
            Empresas
          </Link>
          <Boton onClick={() => setEditando('nuevo')}>+ Nuevo usuario</Boton>
        </div>
      </div>

      {editando === 'nuevo' && <FormularioUsuario usuario={null} usuarios={usuarios} empresas={empresas} cargos={cargos} alTerminar={() => setEditando(null)} />}

      <Campo etiqueta="Buscar" className="max-w-sm">
        {(a11y) => <Entrada {...a11y} placeholder="Nombre o correo" value={filtro} onChange={(e) => setFiltro(e.target.value)} />}
      </Campo>
      <ul className="space-y-2">
        {visibles.map((u) =>
          editando !== 'nuevo' && editando?.id === u.id ? (
            <li key={u.id}>
              <FormularioUsuario usuario={u} usuarios={usuarios} empresas={empresas} cargos={cargos} alTerminar={() => setEditando(null)} />
            </li>
          ) : (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
              <div className="min-w-0">
                <p className="font-medium">
                  {u.nombre} {!u.activo && <Insignia>Inactivo</Insignia>}
                </p>
                <p className="truncate text-sm text-slate-600">
                  {u.email} · {cargos.find((c) => c.codigo === u.cargoId)?.nombre ?? u.cargoId} · {empresas.find((e) => e.id === u.empresaId)?.nombre ?? u.empresaId}
                </p>
                <p className="text-xs text-slate-500">
                  Jefe: {u.jefeInmediatoId ? nombre.get(u.jefeInmediatoId) : '—'} · Directivo: {u.jefeDirectivoId ? nombre.get(u.jefeDirectivoId) : '—'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {u.roles.map((r) => (
                  <Insignia key={r} tono="info">
                    {NOMBRE_ROL[r]}
                  </Insignia>
                ))}
                <Boton variante="secundario" className="ml-2" onClick={() => setEditando(u)}>
                  Editar
                </Boton>
              </div>
            </li>
          ),
        )}
      </ul>

      <Cargos />
    </div>
  );
}

function FormularioUsuario({
  usuario,
  usuarios,
  empresas,
  cargos,
  alTerminar,
}: {
  usuario: UsuarioAdminResponse | null;
  usuarios: UsuarioAdminResponse[];
  empresas: Array<{ id: string; nombre: string; activa: boolean }>;
  cargos: Array<{ codigo: string; nombre: string; activo: boolean }>;
  alTerminar: () => void;
}) {
  const guardar = useGuardarUsuario();
  const contrasena = useAsignarContrasena();
  const [clave, setClave] = useState('');
  const { register, handleSubmit, formState } = useForm<UsuarioRequest>({
    resolver: zodResolver(usuarioRequestSchema),
    defaultValues: usuario
      ? { ...usuario, jefeInmediatoId: usuario.jefeInmediatoId ?? '', jefeDirectivoId: usuario.jefeDirectivoId ?? '' }
      : { nombre: '', email: '', cargoId: cargos[0]?.codigo ?? '', empresaId: empresas[0]?.id ?? '', jefeInmediatoId: '', jefeDirectivoId: '', roles: ['VIAJERO'], activo: true },
  });
  const e = formState.errors;
  const posiblesJefes = usuarios.filter((u) => u.activo && u.id !== usuario?.id);

  const enviar = handleSubmit((datos) =>
    guardar.mutate(
      { id: usuario?.id ?? null, datos },
      {
        onSuccess: async (guardado) => {
          if (clave) await contrasena.mutateAsync({ id: guardado.id, contrasena: clave });
          alTerminar();
        },
      },
    ),
  );

  return (
    <Tarjeta>
      <form noValidate onSubmit={enviar} className="space-y-3">
        <h2 className="text-lg font-semibold">{usuario ? `Editar: ${usuario.nombre}` : 'Nuevo usuario'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre completo" error={e.nombre?.message}>
            {(a11y) => <Entrada {...a11y} {...register('nombre')} error={e.nombre?.message} />}
          </Campo>
          <Campo etiqueta="Correo corporativo" error={e.email?.message}>
            {(a11y) => <Entrada {...a11y} type="email" {...register('email')} error={e.email?.message} />}
          </Campo>
          <Campo etiqueta="Empresa" error={e.empresaId?.message}>
            {(a11y) => (
              <Seleccion {...a11y} {...register('empresaId')}>
                {empresas.filter((x) => x.activa).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                  </option>
                ))}
              </Seleccion>
            )}
          </Campo>
          <Campo etiqueta="Cargo (define sus tarifas)" error={e.cargoId?.message}>
            {(a11y) => (
              <Seleccion {...a11y} {...register('cargoId')}>
                {cargos.filter((c) => c.activo).map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.nombre}
                  </option>
                ))}
              </Seleccion>
            )}
          </Campo>
          <Campo etiqueta="Jefe inmediato" ayuda="Vacío para directivos: sus viajes los aprueba la gerencia.">
            {(a11y) => (
              <Seleccion {...a11y} {...register('jefeInmediatoId')}>
                <option value="">— Ninguno —</option>
                {posiblesJefes.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </Seleccion>
            )}
          </Campo>
          <Campo etiqueta="Jefe directivo" ayuda="Aprueba cuando la solicitud supera la política.">
            {(a11y) => (
              <Seleccion {...a11y} {...register('jefeDirectivoId')}>
                <option value="">— Ninguno —</option>
                {posiblesJefes.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </Seleccion>
            )}
          </Campo>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Roles</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" value={r} {...register('roles')} /> {NOMBRE_ROL[r]}
              </label>
            ))}
          </div>
          {e.roles && <p className="text-sm text-red-700">Asigne al menos un rol</p>}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
          <Campo etiqueta={usuario ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'} ayuda="Mínimo 10 caracteres, con letras y números.">
            {(a11y) => <Entrada {...a11y} type="text" autoComplete="new-password" value={clave} onChange={(ev) => setClave(ev.target.value)} />}
          </Campo>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" {...register('activo')} /> Activo
          </label>
        </div>
        {(guardar.error ?? contrasena.error) && <Alerta tono="peligro">{mensajeDeError(guardar.error ?? contrasena.error)}</Alerta>}
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={alTerminar}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={guardar.isPending || contrasena.isPending}>
            Guardar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}

function Cargos() {
  const api = useApi();
  const { data } = useSuspenseQuery(cargosOptions(api));
  const guardar = useGuardarCargo();
  const { register, handleSubmit, formState, reset } = useForm<CargoRequest>({ resolver: zodResolver(cargoSchema), defaultValues: { codigo: '', nombre: '', activo: true } });
  const e = formState.errors;
  return (
    <Tarjeta className="space-y-3">
      <h2 className="text-lg font-semibold">Cargos</h2>
      <p className="text-sm text-slate-600">Las tarifas de viáticos se definen por cargo (contabilidad las carga en Conceptos y tarifas).</p>
      <ul className="flex flex-wrap gap-2">
        {data.map((c) => (
          <li key={c.codigo} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm ring-1 ring-slate-200">
            <span className={c.activo ? '' : 'text-slate-400 line-through'}>{c.nombre}</span>
            <button type="button" className="text-xs font-semibold text-marca-700 hover:underline" onClick={() => guardar.mutate({ ...c, activo: !c.activo })}>
              {c.activo ? 'Desactivar' : 'Activar'}
            </button>
          </li>
        ))}
      </ul>
      <form noValidate onSubmit={handleSubmit((d) => guardar.mutate(d, { onSuccess: () => reset() }))} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <Campo etiqueta="Código" error={e.codigo?.message}>
          {(a11y) => <Entrada {...a11y} className="uppercase" placeholder="GERENTE_REGIONAL" {...register('codigo')} error={e.codigo?.message} />}
        </Campo>
        <Campo etiqueta="Nombre" error={e.nombre?.message}>
          {(a11y) => <Entrada {...a11y} placeholder="Gerente regional" {...register('nombre')} error={e.nombre?.message} />}
        </Campo>
        <Boton type="submit" cargando={guardar.isPending}>
          Agregar
        </Boton>
      </form>
      {guardar.error && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
    </Tarjeta>
  );
}
