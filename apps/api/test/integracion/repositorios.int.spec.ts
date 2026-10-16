import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FechaCalendario } from '@viaticos/shared-kernel';
import { Money } from '@viaticos/shared-kernel';
import { Anticipo } from '../../src/modules/anticipos/domain/anticipo';
import { AnticipoRepositoryDrizzle } from '../../src/modules/anticipos/infrastructure/persistencia/anticipo.repository.drizzle';
import { DetectorDuplicados } from '../../src/modules/comprobantes/domain/duplicados/detector-duplicados';
import { HuellaComprobante } from '../../src/modules/comprobantes/domain/duplicados/huella-comprobante';
import { HuellaRepositoryDrizzle } from '../../src/modules/comprobantes/infrastructure/persistencia/huella.repository.drizzle';
import { Destino } from '../../src/modules/solicitudes/domain/destino';
import { crearReglasEscalamiento } from '../../src/modules/solicitudes/domain/escalamiento/fabrica-reglas';
import { evaluarEscalamiento } from '../../src/modules/solicitudes/domain/escalamiento/regla-escalamiento';
import { estimarPresupuesto } from '../../src/modules/solicitudes/domain/presupuesto-viaje';
import { SolicitudViaje } from '../../src/modules/solicitudes/domain/solicitud-viaje';
import { ConfiguracionEscalamientoDrizzle } from '../../src/modules/solicitudes/infrastructure/persistencia/configuracion-escalamiento.repository.drizzle';
import { SolicitudRepositoryDrizzle } from '../../src/modules/solicitudes/infrastructure/persistencia/solicitud.repository.drizzle';
import { CacheTasasDrizzle } from '../../src/modules/tasas/infrastructure/cache-tasas';
import { TarifaRepositoryDrizzle } from '../../src/modules/tarifas/infrastructure/persistencia/tarifas.repository.drizzle';
import type { ConexionBaseDatos } from '../../src/shared/infrastructure/base-datos/conexion';
import { URL_PRUEBAS, prepararBaseDePruebas } from './base-de-pruebas';

describe.runIf(URL_PRUEBAS)('Repositorios PostgreSQL (integración)', () => {
  let conexion: ConexionBaseDatos;
  beforeAll(async () => {
    conexion = await prepararBaseDePruebas();
  });
  afterAll(async () => {
    await conexion?.onApplicationShutdown();
  });

  async function nuevaSolicitud(id: string, valorHotel: string) {
    const tarifas = await new TarifaRepositoryDrizzle(conexion.db).buscarPorCargoYPais('ANALISTA', 'BR');
    const destino = Destino.crear({ paisCodigo: 'BR', ciudad: 'Rio', fechaInicio: '2026-11-02', fechaFin: '2026-11-06' });
    const presupuesto = estimarPresupuesto({
      monedaAnticipo: 'USD',
      tasas: [],
      destinos: [
        {
          destino,
          valoresSolicitados: new Map([['ALOJAMIENTO', valorHotel]]),
          tarifas: tarifas.map((t) => ({
            tarifaId: t.id,
            conceptoCodigo: t.conceptoCodigo,
            conceptoNombre: t.conceptoCodigo,
            unidad: t.conceptoCodigo === 'ALOJAMIENTO' ? 'NOCHE' : 'DIA',
            valorUnitario: t.valorUnitario,
          })),
        },
      ],
    });
    const reglas = crearReglasEscalamiento(await new ConfiguracionEscalamientoDrizzle(conexion.db).obtener());
    return SolicitudViaje.crear({
      id,
      aprobadores: { viajeroId: 'u-viajero', jefeInmediatoId: 'u-jefe', jefeDirectivoId: 'u-directivo' },
      motivo: 'Visita a cliente en Rio',
      justificacion: 'Hotel junto al cliente',
      destinos: [destino],
      presupuesto,
      escalamiento: evaluarEscalamiento(presupuesto, reglas),
      ahora: new Date('2026-10-15T15:00:00Z'),
    });
  }

  describe('SolicitudRepositoryDrizzle', () => {
    it('guarda y reconstruye el agregado completo', async () => {
      const repo = new SolicitudRepositoryDrizzle(conexion.db);
      const original = await nuevaSolicitud('00000000-0000-4000-8000-000000000001', '50');
      await repo.guardar(original);

      const leida = (await repo.obtenerPorId(original.id))!;
      expect(leida.presupuesto.totalAnticipo.toDto()).toEqual(original.presupuesto.totalAnticipo.toDto());
      expect(leida.presupuesto.lineas.find((l) => l.conceptoCodigo === 'ALOJAMIENTO')!.excedeTarifa).toBe(true);
      expect(leida.escalamiento.requiereJefeDirectivo).toBe(true);
      expect(leida.ruta.pasosSnapshot.map((p) => p.aprobadorId)).toEqual(['u-jefe', 'u-directivo']);
      expect(leida.destinos[0]!.fechaInicio.equals(FechaCalendario.of('2026-11-02'))).toBe(true);
      expect(leida.version).toBe(1);
    });

    it('la bandeja solo muestra la solicitud al aprobador del turno actual', async () => {
      const repo = new SolicitudRepositoryDrizzle(conexion.db);
      const id = '00000000-0000-4000-8000-000000000002';
      await repo.guardar(await nuevaSolicitud(id, '50'));
      const ids = async (u: string) => (await repo.listarPendientesDeAprobador(u)).map((s) => s.id);

      expect(await ids('u-jefe')).toContain(id);
      expect(await ids('u-directivo')).not.toContain(id);

      const s = (await repo.obtenerPorId(id))!;
      s.aprobar('u-jefe', new Date());
      await repo.guardar(s);
      expect(await ids('u-jefe')).not.toContain(id);
      expect(await ids('u-directivo')).toContain(id);
    });

    it('rechaza escrituras con versión desactualizada', async () => {
      const repo = new SolicitudRepositoryDrizzle(conexion.db);
      const id = '00000000-0000-4000-8000-000000000003';
      await repo.guardar(await nuevaSolicitud(id, '30'));
      const a = (await repo.obtenerPorId(id))!;
      const b = (await repo.obtenerPorId(id))!;
      a.aprobar('u-jefe', new Date());
      await repo.guardar(a);
      b.rechazar('u-jefe', new Date(), 'Rechazo concurrente');
      await expect(repo.guardar(b)).rejects.toMatchObject({ codigo: 'CONFLICTO_CONCURRENCIA' });
    });

    it('un id que no es UUID no rompe la consulta', async () => {
      expect(await new SolicitudRepositoryDrizzle(conexion.db).obtenerPorId('no-es-uuid')).toBeNull();
    });
  });

  describe('HuellaRepositoryDrizzle', () => {
    const sha = (n: number) => n.toString(16).padStart(64, '0');
    const huella = (datos: Parameters<typeof HuellaComprobante.crear>[0]) => HuellaComprobante.crear(datos);

    it('encuentra candidatos por imagen similar usando distancia de Hamming en SQL', async () => {
      const repo = new HuellaRepositoryDrizzle(conexion.db);
      await repo.registrar({ comprobanteId: 'img-1', viajeroId: 'ana', huella: huella({ sha256: sha(101), hashPerceptual: 'ffffffffffff0000' }) });
      const candidatos = await repo.buscarCandidatos(huella({ sha256: sha(102), hashPerceptual: 'ffffffffffff000f' }));
      const resultado = new DetectorDuplicados().evaluar(huella({ sha256: sha(102), hashPerceptual: 'ffffffffffff000f' }), candidatos);
      expect(resultado).toMatchObject({ veredicto: 'SOSPECHOSO', coincidencias: [{ codigo: 'IMAGEN_SIMILAR', comprobanteId: 'img-1' }] });
    });

    it('los índices únicos frenan una carrera entre dos radicaciones simultáneas', async () => {
      const repo = new HuellaRepositoryDrizzle(conexion.db);
      const misma = { sha256: sha(201), emisorId: '900123456', numeroDocumento: 'FE-77' };
      const resultados = await Promise.allSettled([
        repo.registrar({ comprobanteId: 'carrera-a', viajeroId: 'ana', huella: huella(misma) }),
        repo.registrar({ comprobanteId: 'carrera-b', viajeroId: 'luis', huella: huella(misma) }),
      ]);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(resultados.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { codigo: 'COMPROBANTE_DUPLICADO' },
      });
    });

    it('una huella anulada deja de bloquear', async () => {
      const repo = new HuellaRepositoryDrizzle(conexion.db);
      await repo.registrar({ comprobanteId: 'anulable', viajeroId: 'ana', huella: huella({ sha256: sha(301) }) });
      await repo.anular('anulable');
      await expect(
        repo.registrar({ comprobanteId: 'nuevo', viajeroId: 'ana', huella: huella({ sha256: sha(301) }) }),
      ).resolves.toBeUndefined();
    });
  });
  describe('AnticipoRepositoryDrizzle', () => {
    const nuevo = (id: string, solicitudId: string) =>
      Anticipo.crearDesdeSolicitud({
        id,
        solicitudId,
        viajeroId: 'u-viajero',
        monto: Money.of('1900000', 'COP'),
        viaje: { motivo: 'Cliente', destinos: [{ paisCodigo: 'BR', ciudad: 'Rio', fechaInicio: '2026-11-02', fechaFin: '2026-11-06' }] },
        ahora: new Date('2026-10-20T15:00:00Z'),
      });

    it('persiste el ciclo completo hasta el desembolso', async () => {
      const repo = new AnticipoRepositoryDrizzle(conexion.db);
      const a = nuevo('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
      await repo.guardar(a);
      const leido = (await repo.obtenerPorId(a.id))!;
      leido.registradoEnErp('SIESA-9', new Date());
      await repo.guardar(leido);
      const otraVez = (await repo.obtenerPorId(a.id))!;
      otraVez.registrarDesembolso({
        fecha: FechaCalendario.of('2026-10-20'),
        medio: 'EFECTIVO',
        referencia: null,
        tesoreroId: 'u-tesoreria',
        ahora: new Date('2026-10-20T16:00:00Z'),
      });
      await repo.guardar(otraVez);
      const final = (await repo.obtenerPorSolicitud(a.solicitudId))!;
      expect(final.estado).toBe('DESEMBOLSADO');
      expect(final.monto.toDto()).toEqual({ monto: '1900000.00', moneda: 'COP' });
      expect(final.desembolso?.fecha.toString()).toBe('2026-10-20');
      expect((await repo.listarPorEstados(['DESEMBOLSADO'])).map((x) => x.id)).toContain(a.id);
    });

    it('una solicitud no puede tener dos anticipos (índice único)', async () => {
      const repo = new AnticipoRepositoryDrizzle(conexion.db);
      const solicitud = '20000000-0000-4000-8000-000000000002';
      await repo.guardar(nuevo('10000000-0000-4000-8000-000000000002', solicitud));
      await expect(repo.guardar(nuevo('10000000-0000-4000-8000-000000000003', solicitud))).rejects.toThrow();
    });
  });
});

describe.runIf(URL_PRUEBAS)('Caché de tasas en PostgreSQL (integración)', () => {
  let conexion: ConexionBaseDatos;
  beforeAll(async () => {
    conexion = await prepararBaseDePruebas();
  });
  afterAll(async () => {
    await conexion?.onApplicationShutdown();
  });

  it('guarda una cotización por moneda y fecha, y no la sobrescribe', async () => {
    const cache = new CacheTasasDrizzle(conexion.db);
    const cotizacion = { moneda: 'COP', fecha: '2026-10-11', porDolar: '4123.45', fechaPublicada: '2026-10-10', fuente: 'TRM' };
    await cache.guardar(cotizacion);
    await cache.guardar({ ...cotizacion, porDolar: '9999' });
    const leida = await cache.obtener('COP', '2026-10-11');
    expect(leida).toMatchObject({ moneda: 'COP', fechaPublicada: '2026-10-10', fuente: 'TRM' });
    expect(Number(leida!.porDolar)).toBe(4123.45);
    expect(await cache.obtener('COP', '2026-10-12')).toBeNull();
    expect((await cache.ultimaHasta('COP', '2026-10-13', '2026-10-08'))?.fecha).toBe('2026-10-11');
    expect(await cache.ultimaHasta('COP', '2026-10-10', '2026-10-05')).toBeNull();
  });
});
