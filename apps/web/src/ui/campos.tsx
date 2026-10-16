import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { t } from '../i18n';
import { cx } from '../lib/cx';

const BASE =
  'block min-h-11 rounded-lg border bg-white px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 sm:text-sm';
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
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
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
