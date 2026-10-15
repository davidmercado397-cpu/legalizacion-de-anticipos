import type { AnticipoResponse } from '@viaticos/contracts';
import type { DirectorioPersonas } from '../application/puertos';
import type { Anticipo } from '../domain/anticipo';

export class PresentadorAnticipos {
  constructor(private readonly directorio: DirectorioPersonas) {}

  async uno(a: Anticipo): Promise<AnticipoResponse> {
    return (await this.varios([a]))[0]!;
  }

  async varios(lista: readonly Anticipo[]): Promise<AnticipoResponse[]> {
    const nombres = await this.directorio.nombres(
      lista.flatMap((a) => [a.viajeroId, ...(a.desembolso ? [a.desembolso.registradoPor] : [])]),
    );
    return lista.map((a) => {
      const { inicio, fin } = a.rangoViaje;
      return {
        id: a.id,
        solicitudId: a.solicitudId,
        viajeroId: a.viajeroId,
        viajeroNombre: nombres.get(a.viajeroId) ?? a.viajeroId,
        monto: a.monto.toDto(),
        estado: a.estado,
        viaje: {
          motivo: a.viaje.motivo,
          fechaInicio: inicio.toString(),
          fechaFin: fin.toString(),
          destinos: a.viaje.destinos.map((d) => ({ paisCodigo: d.paisCodigo, ciudad: d.ciudad })),
        },
        erp: { ...a.erp },
        desembolso: a.desembolso && {
          fecha: a.desembolso.fecha.toString(),
          medio: a.desembolso.medio,
          referencia: a.desembolso.referencia,
          registradoPor: nombres.get(a.desembolso.registradoPor) ?? a.desembolso.registradoPor,
          registradoEn: a.desembolso.registradoEn.toISOString(),
        },
        creadoEn: a.creadoEn.toISOString(),
      };
    });
  }
}
