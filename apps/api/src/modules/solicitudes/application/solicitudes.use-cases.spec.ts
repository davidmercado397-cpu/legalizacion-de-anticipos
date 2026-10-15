import { beforeEach, describe, expect, it } from 'vitest';
import { FechaCalendario, TasaCambio, type FechaCalendario as Fecha } from '@viaticos/shared-kernel';
import type { EventoDominio } from '../../../shared/domain/agregado-raiz';
import type { ProveedorTasaCambio, PublicadorEventos, Reloj } from '../../../shared/application/puertos';
import { tarifasBrasil } from '../test-support/fabricas';
import {
  CONFIGURACION_ESCALAMIENTO_DESARROLLO,
  ConfiguracionEscalamientoEnMemoria,
} from '../infrastructure/configuracion-escalamiento.repository.memoria';
import { SolicitudRepositoryEnMemoria } from '../infrastructure/solicitud.repository.memoria';
import { ConsultarSolicitudesUseCase } from './consultar-solicitudes.use-case';
import { CotizadorViaje } from './cotizador-viaje';
import { CrearSolicitudUseCase } from './crear-solicitud.use-case';
import { AprobarSolicitudUseCase } from './decidir-solicitud.use-cases';
import { EstimarViajeUseCase } from './estimar-viaje.use-case';
import type { ConsultaTarifas, DirectorioOrganizacional, PerfilViajero } from './puertos';

// ---------- Fakes de los puertos ----------
const reloj: Reloj = { ahora: () => new Date('2026-10-15T15:00:00Z'), hoy: () => FechaCalendario.of('2026-10-15') };
const tasas: ProveedorTasaCambio = {
  obtener: async (o: string, d: string, f: Fecha) => new TasaCambio(o, d, o === 'USD' ? '4000' : '0.00025', f, 'FAKE'),
};
const tarifas: ConsultaTarifas = {
  vigentes: async (_c, pais) => (pais === 'BR' ? tarifasBrasil() : []),
  paisesDisponibles: async () => ['BR'],
};
const perfiles: Record<string, PerfilViajero> = {
  ana: { id: 'ana', cargoId: 'ANALISTA', jefeInmediatoId: 'carlos', jefeDirectivoId: 'diana' },
};
const directorio: DirectorioOrganizacional = {
  obtenerViajero: async (id) => perfiles[id] ?? null,
  nombres: async () => new Map(),
};

class EventosEnMemoria implements PublicadorEventos {
  publicados: EventoDominio[] = [];
  async publicar(eventos: readonly EventoDominio[]) {
    this.publicados.push(...eventos);
  }
}

const destinoRio = (valorHotel?: string) => ({
  paisCodigo: 'BR',
  ciudad: 'Rio de Janeiro',
  fechaInicio: '2026-11-02',
  fechaFin: '2026-11-06',
  valoresSolicitados: valorHotel ? [{ conceptoCodigo: 'ALOJAMIENTO', valorUnitario: valorHotel }] : [],
});

describe('Casos de uso de solicitudes', () => {
  let eventos: EventosEnMemoria;
  let repo: SolicitudRepositoryEnMemoria;
  let cotizador: CotizadorViaje;
  let n: number;

  beforeEach(() => {
    eventos = new EventosEnMemoria();
    repo = new SolicitudRepositoryEnMemoria();
    n = 0;
    cotizador = new CotizadorViaje(
      directorio,
      tarifas,
      tasas,
      new ConfiguracionEscalamientoEnMemoria(CONFIGURACION_ESCALAMIENTO_DESARROLLO),
      reloj,
    );
  });

  const crear = () => new CrearSolicitudUseCase(cotizador, repo, { nuevo: () => `s${++n}` }, reloj, eventos);

  it('estima en COP convirtiendo tarifas en USD con la TRM', async () => {
    const r = await new EstimarViajeUseCase(cotizador).ejecutar({
      viajeroId: 'ana',
      monedaAnticipo: 'COP',
      destinos: [destinoRio()],
    });
    expect(r.presupuesto.totalAnticipo.toDto()).toEqual({ monto: '1180000.00', moneda: 'COP' });
    expect(r.escalamiento.requiereJefeDirectivo).toBe(false);
  });

  it('el caso del negocio: hotel a 50 USD con tarifa de 30 escala a jefe directivo', async () => {
    const r = await new EstimarViajeUseCase(cotizador).ejecutar({
      viajeroId: 'ana',
      monedaAnticipo: 'USD',
      destinos: [destinoRio('50')],
    });
    expect(r.escalamiento).toMatchObject({ requiereJefeDirectivo: true, motivos: [{ codigo: 'EXCEDE_TARIFA' }] });
  });

  it('falla si el viajero no existe', async () => {
    await expect(
      new EstimarViajeUseCase(cotizador).ejecutar({ viajeroId: 'x', monedaAnticipo: 'USD', destinos: [destinoRio()] }),
    ).rejects.toMatchObject({ codigo: 'VIAJERO_NO_ENCONTRADO' });
  });

  it('crea la solicitud, la persiste y publica SolicitudEnviada', async () => {
    const s = await crear().ejecutar({
      viajeroId: 'ana',
      monedaAnticipo: 'USD',
      destinos: [destinoRio()],
      motivo: 'Implementación en cliente Rio',
    });
    expect(await repo.obtenerPorId(s.id)).not.toBeNull();
    expect(eventos.publicados.map((e) => e.tipo)).toEqual(['solicitudes.SolicitudEnviada']);
  });

  it('flujo completo con escalamiento: jefe inmediato → directivo → SolicitudAprobada', async () => {
    const s = await crear().ejecutar({
      viajeroId: 'ana',
      monedaAnticipo: 'USD',
      destinos: [destinoRio('50')],
      motivo: 'Implementación en cliente Rio',
      justificacion: 'Único hotel disponible junto al cliente',
    });
    const consultar = new ConsultarSolicitudesUseCase(repo);
    expect((await consultar.listarPendientesDeAprobar('carlos')).map((x) => x.id)).toEqual([s.id]);
    expect(await consultar.listarPendientesDeAprobar('diana')).toEqual([]);

    const aprobar = new AprobarSolicitudUseCase(repo, reloj, eventos);
    await aprobar.ejecutar({ solicitudId: s.id, aprobadorId: 'carlos' });
    expect((await consultar.listarPendientesDeAprobar('diana')).map((x) => x.id)).toEqual([s.id]);

    const final = await aprobar.ejecutar({ solicitudId: s.id, aprobadorId: 'diana', comentario: 'OK' });
    expect(final.estado).toBe('APROBADA');
    expect(eventos.publicados.at(-1)).toMatchObject({
      tipo: 'solicitudes.SolicitudAprobada',
      totalAnticipo: { monto: '375.00', moneda: 'USD' },
    });
  });

  it('detecta modificaciones concurrentes (concurrencia optimista)', async () => {
    const s = await crear().ejecutar({
      viajeroId: 'ana',
      monedaAnticipo: 'USD',
      destinos: [destinoRio()],
      motivo: 'Implementación en cliente Rio',
    });
    const copiaA = (await repo.obtenerPorId(s.id))!;
    const copiaB = (await repo.obtenerPorId(s.id))!;
    copiaA.aprobar('carlos', reloj.ahora());
    await repo.guardar(copiaA);
    copiaB.rechazar('carlos', reloj.ahora(), 'Rechazo simultáneo');
    await expect(repo.guardar(copiaB)).rejects.toMatchObject({ codigo: 'CONFLICTO_CONCURRENCIA' });
  });
});
