import { Upload } from 'lucide-react';
import { useSubirGasto } from '@viaticos/client-app';
import { type DragEvent, useRef, useState } from 'react';
import { cx } from '../../lib/cx';
import { mensajeDeError } from '../../lib/errores';
import { sinRechazo } from '../../lib/sin-rechazo';
import { Boton } from '../../ui/boton';
import { Alerta } from '../../ui/superficies';
import { prepararArchivo } from './preparar-imagen';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const HEIC = /\.(heic|heif)$/i;

interface Fallido {
  nombre: string;
  motivo: string;
}

/** Por qué un archivo no se puede subir, antes de gastar datos en enviarlo; `null` si sirve. */
export function motivoRechazo(archivo: File): string | null {
  if (archivo.type === 'image/heic' || archivo.type === 'image/heif' || HEIC.test(archivo.name)) {
    return 'Es una foto HEIC del iPhone: ábrala y guárdela como JPG, o súbala desde el celular (allí se convierte sola).';
  }
  // Sin tipo declarado (pasa al arrastrar desde algunas carpetas) decide el servidor, que mira el contenido real.
  if (archivo.type && !TIPOS.includes(archivo.type)) return 'Solo se aceptan fotos (JPG, PNG o WebP) o PDF.';
  return null;
}

/**
 * Subir facturas desde la web: se eligen o se arrastran una o varias fotos o PDF (uno por factura). Cada archivo se
 * sube por separado, así que si uno falla los demás siguen; la lectura con IA sigue en segundo plano.
 */
export function SubirFactura({ anticipoId }: { anticipoId: string }) {
  const subir = useSubirGasto();
  const entrada = useRef<HTMLInputElement>(null);
  const [encima, setEncima] = useState(false);
  const [avance, setAvance] = useState<{ hechos: number; total: number } | null>(null);
  const [subidos, setSubidos] = useState(0);
  const [fallidos, setFallidos] = useState<Fallido[]>([]);

  async function alElegir(lista: FileList | null) {
    const archivos = Array.from(lista ?? []);
    if (entrada.current) entrada.current.value = '';
    if (archivos.length === 0 || avance) return;
    const problemas: Fallido[] = [];
    const validos = archivos.filter((a) => {
      const motivo = motivoRechazo(a);
      if (motivo) problemas.push({ nombre: a.name, motivo });
      return !motivo;
    });
    let exitos = 0;
    setSubidos(0);
    setFallidos(problemas);
    for (const [i, archivo] of validos.entries()) {
      setAvance({ hechos: i, total: validos.length });
      try {
        const { contenido, nombre } = await prepararArchivo(archivo);
        await subir.mutateAsync({ archivo: contenido, anticipoId, nombre });
        exitos += 1;
      } catch (error) {
        problemas.push({ nombre: archivo.name, motivo: mensajeDeError(error) });
      }
    }
    setAvance(null);
    setSubidos(exitos);
    setFallidos([...problemas]);
  }

  function alSoltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setEncima(false);
    void sinRechazo(alElegir)(e.dataTransfer.files);
  }

  return (
    <div className="space-y-2">
      <div
        className={cx(
          'flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center transition-colors',
          encima ? 'border-marca-600 bg-marca-50' : 'border-slate-300 bg-white',
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setEncima(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEncima(false);
        }}
        onDrop={alSoltar}
      >
        <p className="text-sm text-slate-700">
          <span className="hidden sm:inline">Arrastra aquí las fotos o PDF de tus facturas, o elígelos.</span>
          <span className="sm:hidden">Toma la foto o elige las fotos o PDF de tus facturas.</span>
        </p>
        <input
          ref={entrada}
          type="file"
          accept={TIPOS.join(',')}
          multiple
          className="sr-only"
          aria-label="Fotos o PDF de las facturas"
          onChange={(e) => void sinRechazo(alElegir)(e.target.files)}
        />
        <Boton variante="secundario" cargando={avance !== null} onClick={() => entrada.current?.click()}>
          <Upload aria-hidden />
          {avance ? `Subiendo ${avance.hechos + 1} de ${avance.total}…` : 'Agregar facturas'}
        </Boton>
        <p className="text-xs text-slate-500">JPG, PNG, WebP o PDF · una factura por archivo · puedes elegir varios a la vez</p>
      </div>
      {subidos > 0 && (
        <Alerta tono="exito">
          {subidos === 1 ? 'Se subió 1 factura.' : `Se subieron ${subidos} facturas.`} Revisa los datos de cada una abajo y confírmalos.
        </Alerta>
      )}
      {fallidos.length > 0 && (
        <Alerta tono="peligro" titulo={fallidos.length === 1 ? 'Un archivo no se subió' : `${fallidos.length} archivos no se subieron`}>
          <ul className="list-disc space-y-1 pl-5">
            {fallidos.map((f, i) => (
              <li key={`${f.nombre}-${i}`}>
                <span className="font-medium">{f.nombre}</span>: {f.motivo}
              </li>
            ))}
          </ul>
        </Alerta>
      )}
    </div>
  );
}
