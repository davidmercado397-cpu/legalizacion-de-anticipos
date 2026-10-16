import { createFileRoute } from '@tanstack/react-router';
import { useAnticipos, useCompanias } from '@viaticos/client-app';
import { useState } from 'react';
import { ListaAnticipos } from '../../../features/anticipos/componentes';
import { ReglasPolitica } from '../../../features/administracion/reglas-politica';
import { mensajeDeError } from '../../../lib/errores';
import { exigir } from '../../../lib/roles';
import { Seleccion } from '../../../ui/campos';
import { Alerta, Cargando } from '../../../ui/superficies';

export const Route = createFileRoute('/_app/contabilidad/')({
  beforeLoad: ({ context }) => exigir(context.sesion, 'contabilidad'),
  component: Contabilidad,
});

function Contabilidad() {
  const enRevision = useAnticipos({ status: 'in_review', limit: 100 });
  const cerradas = useAnticipos({ status: 'closed', limit: 20 });
  const companias = useCompanias();
  const [compania, setCompania] = useState<string>('');
  const elegida = compania || companias.data?.[0]?.id;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Contabilidad</h1>
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">Legalizaciones por revisar</h2>
        {enRevision.isPending ? (
          <Cargando />
        ) : enRevision.isError ? (
          <Alerta tono="peligro">{mensajeDeError(enRevision.error)}</Alerta>
        ) : (
          <ListaAnticipos anticipos={enRevision.data.data} mostrarEmpleado vacio="No hay legalizaciones en revisión" />
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">Legalizadas recientemente</h2>
        {cerradas.data && <ListaAnticipos anticipos={cerradas.data.data} mostrarEmpleado vacio="Todavía no hay legalizaciones cerradas" />}
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-700">Política de gastos</h2>
          {(companias.data?.length ?? 0) > 1 && (
            <Seleccion aria-label="Compañía" className="w-auto" value={elegida ?? ''} onChange={(e) => setCompania(e.target.value)}>
              {companias.data!.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Seleccion>
          )}
        </div>
        {elegida && <ReglasPolitica companiaId={elegida} />}
      </section>
    </div>
  );
}
