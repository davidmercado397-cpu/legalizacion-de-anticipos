import { Link, type LinkProps } from '@tanstack/react-router';
import { useAnticipos, usePendientesDeAprobar, useSaldosAbiertos, useSesion } from '@viaticos/client-app';
import type { AnticipoResumen } from '@viaticos/contracts';
import { ArrowRight, CircleCheck, Plus, Wallet } from 'lucide-react';
import { puede } from '../../lib/roles';
import { botonClases } from '../../ui/boton';
import { EstadoConsulta, type Consulta } from '../../ui/estado-consulta';
import { EncabezadoPagina, Seccion } from '../../ui/pagina';
import { EstadoVacio, Esqueleto } from '../../ui/superficies';
import { ListaAnticipos } from '../anticipos/componentes';
import { TarjetasSaldo } from '../anticipos/saldos-abiertos';

/** Cuántos de cada bandeja se ven en el inicio; el resto, en su pantalla. */
const MAXIMO = 5;

/** Lo que le toca hacer hoy: primero lo que otros esperan de su rol, después lo propio. */
export function Inicio() {
  const usuario = useSesion((s) => s.usuario);
  const nombre = usuario?.full_name.split(' ')[0];
  const hoy = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="space-y-10">
      <EncabezadoPagina titulo={nombre ? `Hola, ${nombre}` : 'Inicio'} descripcion={hoy.charAt(0).toUpperCase() + hoy.slice(1)} />
      {puede(usuario, 'aprobar') && <PorAprobar />}
      {puede(usuario, 'contabilidad') && <PorRevisar />}
      {puede(usuario, 'tesoreria') && <PorDesembolsar />}
      <TusAnticipos />
    </div>
  );
}

function PorAprobar() {
  const consulta = usePendientesDeAprobar();
  return <Bandeja titulo="Por aprobar" consulta={consulta} lista={consulta.data} todas="/aprobaciones" vacio="Nada espera tu aprobación" />;
}

function PorRevisar() {
  const consulta = useAnticipos({ status: 'in_review', limit: 100 });
  return (
    <Bandeja
      titulo="Legalizaciones por revisar"
      consulta={consulta}
      lista={consulta.data?.data}
      todas="/contabilidad"
      vacio="No hay legalizaciones en revisión"
    />
  );
}

function PorDesembolsar() {
  const consulta = useAnticipos({
    status: 'approved',
    disbursed: false,
    limit: 100,
  });
  return (
    <Bandeja
      titulo="Por desembolsar"
      consulta={consulta}
      lista={consulta.data?.data}
      todas="/tesoreria"
      vacio="No hay anticipos por desembolsar"
    />
  );
}

function Bandeja({
  titulo,
  consulta,
  lista,
  todas,
  vacio,
}: {
  titulo: string;
  consulta: Consulta<unknown>;
  lista: AnticipoResumen[] | undefined;
  todas: LinkProps['to'];
  vacio: string;
}) {
  const total = lista?.length ?? 0;
  return (
    <Seccion
      titulo={titulo}
      {...(total > 0 ? { contador: total } : {})}
      acciones={
        total > MAXIMO && (
          <Link to={todas} className={botonClases({ variante: 'fantasma', tamano: 'pequeno' })}>
            Ver {total}
            <ArrowRight aria-hidden />
          </Link>
        )
      }
    >
      <EstadoConsulta consulta={consulta} cargando={<Esqueleto filas={2} />}>
        {() =>
          total === 0 ? (
            // Una bandeja al día no necesita una caja vacía: basta con decirlo.
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <CircleCheck className="size-4 text-emerald-700" aria-hidden />
              {vacio}
            </p>
          ) : (
            <ListaAnticipos anticipos={(lista ?? []).slice(0, MAXIMO)} mostrarEmpleado vacio={vacio} />
          )
        }
      </EstadoConsulta>
    </Seccion>
  );
}

/** Lo propio: lo que tiene por legalizar, o cómo empezar si no tiene nada. */
function TusAnticipos() {
  const saldos = useSaldosAbiertos();
  return (
    <Seccion
      titulo="Tus anticipos por legalizar"
      {...(saldos.data?.length ? { contador: saldos.data.length } : {})}
      acciones={
        <Link to="/anticipos/nuevo" className={botonClases({ variante: 'secundario', tamano: 'pequeno' })}>
          <Plus aria-hidden />
          Solicitar anticipo
        </Link>
      }
    >
      <EstadoConsulta consulta={saldos} cargando={<Esqueleto filas={2} />}>
        {(lista) =>
          lista.length === 0 ? (
            <EstadoVacio titulo="No tienes anticipos por legalizar" icono={Wallet}>
              Pide uno antes del viaje; las facturas las puedes mandar por WhatsApp.
            </EstadoVacio>
          ) : (
            <TarjetasSaldo saldos={lista} />
          )
        }
      </EstadoConsulta>
    </Seccion>
  );
}
