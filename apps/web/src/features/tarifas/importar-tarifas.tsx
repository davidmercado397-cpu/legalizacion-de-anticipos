import { useImportarTarifas } from '@viaticos/client-app';
import { Upload } from 'lucide-react';
import { useRef } from 'react';
import { detallesDeError, mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Seccion } from '../../ui/pagina';
import { Alerta } from '../../ui/superficies';

type Problema = { row: number; field: string; issue: string };

/** Carga masiva: todo o nada; si una fila tiene un problema, se dice cuál y no se carga ninguna. */
export function ImportarTarifas({ companiaId }: { companiaId: string }) {
  const importar = useImportarTarifas(companiaId);
  const selector = useRef<HTMLInputElement>(null);
  const problemas = detallesDeError(importar.error).filter((d): d is Problema => typeof d.row === 'number');

  return (
    <Seccion
      titulo="Cargar tarifas desde Excel"
      acciones={
        <Boton variante="secundario" tamano="pequeno" cargando={importar.isPending} onClick={() => selector.current?.click()}>
          <Upload aria-hidden />
          Elegir archivo
        </Boton>
      }
    >
      <p className="-mt-1 max-w-prose text-sm text-slate-600">
        Un .xlsx con estas columnas en la primera fila: <strong>Zona, Tipo_personal, Categoria, Valor, Moneda, Unidad, Desde, Hasta</strong>
        . Tipo de personal: administrativo u operativo. Unidad: día, noche o viaje. La categoría va por su código (por ejemplo lodging). Si
        una fila tiene un problema, no se carga ninguna.
      </p>
      <input
        ref={selector}
        type="file"
        className="hidden"
        aria-label="Archivo de tarifas"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (archivo) importar.mutate(archivo);
          e.target.value = '';
        }}
      />
      {importar.isSuccess && <Alerta tono="exito">Se cargaron {importar.data} tarifas.</Alerta>}
      {importar.isError && (
        <Alerta tono="peligro" titulo={mensajeDeError(importar.error)}>
          {problemas.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {problemas.slice(0, 50).map((p, i) => (
                <li key={i}>
                  Fila {p.row}, {p.field}: {p.issue}
                </li>
              ))}
            </ul>
          )}
        </Alerta>
      )}
    </Seccion>
  );
}
