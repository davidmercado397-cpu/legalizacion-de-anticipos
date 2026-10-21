import { useZonas } from '@viaticos/client-app';
import { EstadoConsulta } from '../../ui/estado-consulta';
import { ImportarTarifas } from './importar-tarifas';
import { ListaTarifas } from './lista-tarifas';
import { Zonas } from './zonas';

/**
 * Presupuesto de viaje: el destino del anticipo se busca entre los lugares de las zonas y el valor sale de las
 * tarifas de esa zona para el tipo de personal del viajero. No son topes: pedir otro valor exige justificación.
 */
export function TarifasViaje({ companiaId }: { companiaId: string }) {
  const zonas = useZonas(companiaId);
  return (
    <EstadoConsulta consulta={zonas}>
      {(lista) => (
        <div className="space-y-12">
          <Zonas companiaId={companiaId} zonas={lista} />
          <ListaTarifas companiaId={companiaId} zonas={lista} />
          <ImportarTarifas companiaId={companiaId} />
        </div>
      )}
    </EstadoConsulta>
  );
}
