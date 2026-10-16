import { useConfigurarReglasAprobacion, useReglasAprobacion } from '@viaticos/client-app';
import { useEffect, useState } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { Boton } from '../../ui/boton';
import { Campo, Entrada } from '../../ui/campos';
import { Alerta, Cargando } from '../../ui/superficies';

const MONEDAS = ['COP', 'USD'] as const;

/** Decisiones 4.1 y 4.2: cuándo una solicitud necesita también al jefe directivo. */
export function ReglasAprobacion({ companiaId }: { companiaId: string }) {
  const reglas = useReglasAprobacion(companiaId);
  const guardar = useConfigurarReglasAprobacion(companiaId);
  const [tolerancia, setTolerancia] = useState('');
  const [umbrales, setUmbrales] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!reglas.data) return;
    setTolerancia(String(Number(reglas.data.tolerance_pct)));
    setUmbrales(Object.fromEntries(Object.entries(reglas.data.thresholds ?? {}).map(([m, v]) => [m, String(Number(v))])));
  }, [reglas.data]);

  if (reglas.isPending) return <Cargando />;
  if (reglas.isError) return <Alerta tono="peligro">{mensajeDeError(reglas.error)}</Alerta>;

  return (
    <div className="space-y-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm text-slate-600">
        La solicitud la aprueba el jefe inmediato. También necesita al jefe directivo, que puede aprobarla sin esperar, si supera el presupuesto
        calculado en más de la tolerancia o si supera el monto total de su moneda. Vacío = sin límite por monto.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Tolerancia sobre el presupuesto (%)">
          {(p) => <Entrada {...p} value={tolerancia} onChange={(e) => setTolerancia(e.target.value)} inputMode="decimal" />}
        </Campo>
        {MONEDAS.map((moneda) => (
          <Campo key={moneda} etiqueta={`Monto total que escala (${moneda})`}>
            {(p) => (
              <Entrada
                {...p}
                value={umbrales[moneda] ?? ''}
                onChange={(e) => setUmbrales({ ...umbrales, [moneda]: e.target.value })}
                inputMode="decimal"
              />
            )}
          </Campo>
        ))}
      </div>
      {guardar.isError && <Alerta tono="peligro">{mensajeDeError(guardar.error)}</Alerta>}
      {guardar.isSuccess && <Alerta tono="exito">Reglas guardadas. Aplican a las solicitudes nuevas.</Alerta>}
      <Boton
        cargando={guardar.isPending}
        onClick={() =>
          guardar.mutate({
            tolerance_pct: tolerancia.replace(',', '.'),
            thresholds: Object.fromEntries(
              Object.entries(umbrales)
                .filter(([, v]) => v.trim() !== '')
                .map(([m, v]) => [m, v.replace(/\./g, '').replace(',', '.')]),
            ),
          })
        }
      >
        Guardar
      </Boton>
    </div>
  );
}
