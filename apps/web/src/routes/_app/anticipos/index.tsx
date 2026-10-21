import { Link, createFileRoute } from '@tanstack/react-router';
import { useAnticipos, useSesion } from '@viaticos/client-app';
import { Plus } from 'lucide-react';
import { ListaAnticipos } from '../../../features/anticipos/componentes';
import { SaldosAbiertos } from '../../../features/anticipos/saldos-abiertos';
import { botonClases } from '../../../ui/boton';
import { EstadoConsulta } from '../../../ui/estado-consulta';
import { EncabezadoPagina, Seccion } from '../../../ui/pagina';

export const Route = createFileRoute('/_app/anticipos/')({ component: MisAnticipos });

function MisAnticipos() {
  const usuarioId = useSesion((s) => s.usuario?.id);
  // La API filtra por visibilidad; en "Mis anticipos" solo van los propios.
  const anticipos = useAnticipos({ limit: 100 });

  return (
    <div className="space-y-10">
      <EncabezadoPagina
        titulo="Mis anticipos"
        acciones={
          <Link to="/anticipos/nuevo" className={botonClases()}>
            <Plus aria-hidden />
            Solicitar anticipo
          </Link>
        }
      />

      <SaldosAbiertos />

      <Seccion titulo="Historial">
        <EstadoConsulta consulta={anticipos}>
          {(pagina) => (
            <ListaAnticipos anticipos={pagina.data.filter((a) => a.employee_id === usuarioId)} vacio="Todavía no has solicitado anticipos" />
          )}
        </EstadoConsulta>
      </Seccion>
    </div>
  );
}
