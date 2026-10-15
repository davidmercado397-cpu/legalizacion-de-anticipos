import { useSubirFactura } from '@viaticos/client-app';
import { useRef, useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { prepararArchivo } from '../../lib/preparar-imagen';
import { Boton } from '../../ui/boton';
import { AreaTexto, Campo } from '../../ui/campos';
import { Alerta, Tarjeta } from '../../ui/superficies';

/** Foto (cámara del celular) o archivo + para qué fue la compra. La lectura ocurre en segundo plano. */
export function SubirFactura({ legalizacionId }: { legalizacionId: string }) {
  const subir = useSubirFactura();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [progreso, setProgreso] = useState(0);
  const [errorDescripcion, setErrorDescripcion] = useState<string>();
  const camara = useRef<HTMLInputElement>(null);
  const selector = useRef<HTMLInputElement>(null);

  const elegir = (lista: FileList | null) => {
    setArchivo(lista?.[0] ?? null);
    subir.reset();
  };

  const enviar = async () => {
    if (descripcion.trim().length < 5) {
      setErrorDescripcion('Describa para qué fue la compra (mínimo 5 caracteres)');
      return;
    }
    setErrorDescripcion(undefined);
    const preparado = await prepararArchivo(archivo!);
    subir.mutate(
      { id: legalizacionId, descripcion: descripcion.trim(), archivo: preparado, alProgresar: setProgreso },
      {
        onSuccess: () => {
          setArchivo(null);
          setDescripcion('');
          setProgreso(0);
        },
      },
    );
  };

  return (
    <Tarjeta className="space-y-3">
      <h2 className="text-lg font-semibold">Agregar factura</h2>
      <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => elegir(e.target.files)} />
      <input
        ref={selector}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => elegir(e.target.files)}
      />
      {!archivo ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Boton onClick={() => camara.current?.click()}>📷 Tomar foto</Boton>
          <Boton variante="secundario" onClick={() => selector.current?.click()}>
            Elegir archivo (foto o PDF)
          </Boton>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="truncate text-sm text-slate-700">
            Archivo: <strong>{archivo.name}</strong>{' '}
            <button type="button" className="text-marca-700 underline" onClick={() => setArchivo(null)}>
              cambiar
            </button>
          </p>
          <Campo etiqueta="¿Para qué fue esta compra?" error={errorDescripcion} ayuda="Ej.: cena con el cliente, taxi al aeropuerto, hotel 3 noches.">
            {(a11y) => <AreaTexto {...a11y} rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} error={errorDescripcion} />}
          </Campo>
          {subir.isPending && (
            <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(progreso * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-marca-600 transition-all" style={{ width: `${Math.round(progreso * 100)}%` }} />
            </div>
          )}
          <Boton className="w-full sm:w-auto" cargando={subir.isPending} onClick={() => void enviar()}>
            Subir factura
          </Boton>
        </div>
      )}
      {subir.isError && <Alerta tono="peligro">{mensajeDeError(subir.error)}</Alerta>}
    </Tarjeta>
  );
}
