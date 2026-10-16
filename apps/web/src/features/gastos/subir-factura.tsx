import { useSubirGasto } from '@viaticos/client-app';
import { useRef } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Alerta } from '../../ui/superficies';
import { prepararArchivo } from './preparar-imagen';

/** Una foto o PDF por factura; se puede elegir varias. La lectura con IA sigue en segundo plano. */
export function SubirFactura({ anticipoId }: { anticipoId: string }) {
  const subir = useSubirGasto();
  const entrada = useRef<HTMLInputElement>(null);

  async function alElegir(archivos: FileList | null) {
    for (const archivo of Array.from(archivos ?? [])) {
      const { contenido, nombre } = await prepararArchivo(archivo);
      await subir.mutateAsync({ archivo: contenido, anticipoId, nombre });
    }
    if (entrada.current) entrada.current.value = '';
  }

  return (
    <div className="space-y-2">
      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        className="sr-only"
        aria-label="Fotos o PDF de las facturas"
        onChange={(e) => void alElegir(e.target.files)}
      />
      <Boton cargando={subir.isPending} onClick={() => entrada.current?.click()}>
        Agregar facturas
      </Boton>
      {subir.isError && <Alerta tono="peligro">{mensajeDeError(subir.error)}</Alerta>}
    </div>
  );
}
