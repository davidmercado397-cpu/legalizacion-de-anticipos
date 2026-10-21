import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { t } from '../i18n';
import { cx } from '../lib/cx';

const BASE =
  'block min-h-11 rounded-[10px] border bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 sm:text-sm';
/** Ancho completo salvo que quien lo usa pida otro (`w-auto`, `sm:w-64`…): `cx` no resuelve choques de clases. */
const base = (className?: string) => cx(BASE, !/(^|\s)([a-z]+:)?w-/.test(className ?? '') && 'w-full');
const estado = (error?: string) => (error ? 'border-red-600' : 'border-slate-300 focus:border-marca-600');

interface CampoProps {
  etiqueta: string;
  /** Clave i18n o texto del error. */
  error?: string | undefined;
  ayuda?: ReactNode;
  className?: string;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}

/** Etiqueta + control + mensaje de error accesible (aria-describedby). */
export function Campo({ etiqueta, error, ayuda, className, children }: CampoProps) {
  const id = useId();
  const idMensaje = `${id}-mensaje`;
  return (
    <div className={cx('space-y-1', className)}>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {etiqueta}
      </label>
      {children({ id, ...(error ? { 'aria-invalid': true, 'aria-describedby': idMensaje } : {}) })}
      {error ? (
        <p id={idMensaje} className="text-sm text-red-700">
          {t(error)}
        </p>
      ) : (
        ayuda && <p className="text-sm text-slate-500">{ayuda}</p>
      )}
    </div>
  );
}

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { error?: string | undefined }>(
  ({ className, error, ...props }, ref) => <input ref={ref} {...props} className={cx(base(className), estado(error), className)} />,
);
Entrada.displayName = 'Entrada';

export const Seleccion = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { error?: string | undefined }>(
  ({ className, error, ...props }, ref) => <select ref={ref} {...props} className={cx(base(className), estado(error), className)} />,
);
Seleccion.displayName = 'Seleccion';

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string | undefined }>(
  ({ className, error, ...props }, ref) => (
    <textarea ref={ref} rows={3} {...props} className={cx(base(className), 'py-2', estado(error), className)} />
  ),
);
AreaTexto.displayName = 'AreaTexto';

/** Encendido o apagado: un interruptor (`role="switch"`) con el estado escrito al lado, no solo el color. */
export function Interruptor({
  id,
  activo,
  alCambiar,
  textos = ['Desactivado', 'Activado'],
  ...aria
}: {
  id?: string;
  activo: boolean;
  alCambiar: (activo: boolean) => void;
  textos?: [string, string];
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={activo}
      {...aria}
      onClick={() => alCambiar(!activo)}
      className="inline-flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-900"
    >
      <span className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors', activo ? 'bg-marca-600' : 'bg-slate-300')} aria-hidden>
        <span
          className={cx('absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform', activo && 'translate-x-4')}
        />
      </span>
      {textos[activo ? 1 : 0]}
    </button>
  );
}
