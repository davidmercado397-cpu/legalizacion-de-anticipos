import type { GastoDetalle } from '@viaticos/contracts';
import { ExternalLink, FileText, ImageOff } from 'lucide-react';
import { botonClases } from '../../ui/boton';
import { EstadoVacio } from '../../ui/superficies';

/** La foto o el PDF de la factura, para compararla con los datos sin perderla de vista. */
export function VisorFactura({ gasto }: { gasto: GastoDetalle }) {
  if (!gasto.file) return <EstadoVacio titulo="Sin archivo" icono={ImageOff} />;
  const abrir = (
    <a href={gasto.file.url} target="_blank" rel="noreferrer" className={botonClases({ variante: 'secundario', tamano: 'pequeno' })}>
      {gasto.file.mime_type === 'application/pdf' ? <FileText aria-hidden /> : <ExternalLink aria-hidden />}
      {gasto.file.mime_type === 'application/pdf' ? 'Abrir el PDF de la factura' : 'Abrir en otra pestaña'}
    </a>
  );
  if (gasto.file.mime_type === 'application/pdf') return <EstadoVacio titulo="Factura en PDF" icono={FileText} accion={abrir} />;
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
        <img src={gasto.file.url} alt="Foto de la factura" className="mx-auto max-h-[70dvh] w-full object-contain" />
      </div>
      {abrir}
    </div>
  );
}
