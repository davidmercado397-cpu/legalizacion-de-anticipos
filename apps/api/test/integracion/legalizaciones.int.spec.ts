import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FechaCalendario, Money, TasaCambio } from '@viaticos/shared-kernel';
import { Legalizacion } from '../../src/modules/legalizaciones/domain/legalizacion';
import { EXCLUSIONES_POR_DEFECTO, ReglaExclusion } from '../../src/modules/legalizaciones/domain/reglas-exclusion';
import {
  LegalizacionRepositoryDrizzle,
  PoliticaLegalizacionDrizzle,
} from '../../src/modules/legalizaciones/infrastructure/persistencia/legalizacion.repository.drizzle';
import type { ConexionBaseDatos } from '../../src/shared/infrastructure/base-datos/conexion';
import { URL_PRUEBAS, prepararBaseDePruebas } from './base-de-pruebas';

const f = FechaCalendario.of;
const ahora = new Date('2026-11-10T15:00:00Z');
const archivo = { clave: 'legalizaciones/x/y.jpg', nombre: 'y.jpg', mime: 'image/jpeg', tamano: 10, sha256: 'b'.repeat(64) };

describe.runIf(URL_PRUEBAS)('Legalizaciones en PostgreSQL (integración)', () => {
  let conexion: ConexionBaseDatos;
  beforeAll(async () => {
    conexion = await prepararBaseDePruebas();
  });
  afterAll(async () => {
    await conexion?.onApplicationShutdown();
  });

  it('persiste el agregado completo: soportes, montos con tasa, alertas, decisiones e historial', async () => {
    const repo = new LegalizacionRepositoryDrizzle(conexion.db);
    const l = Legalizacion.abrir({
      id: '30000000-0000-4000-8000-000000000001',
      anticipoId: '40000000-0000-4000-8000-000000000001',
      viajeroId: 'u-viajero',
      montoAnticipo: Money.of(395, 'USD'),
      viaje: { inicio: f('2026-11-02'), fin: f('2026-11-06') },
      ahora,
    });
    l.agregarFactura({ soporteId: '50000000-0000-4000-8000-000000000001', descripcion: 'Cena con cliente', archivo, ahora });
    await repo.guardar(l);
    expect(await repo.listarSoportesProcesando()).toEqual([
      { legalizacionId: l.id, soporteId: '50000000-0000-4000-8000-000000000001' },
    ]);

    const a = (await repo.obtenerPorId(l.id))!;
    a.registrarExtraccion('50000000-0000-4000-8000-000000000001', null, ahora);
    a.confirmarSoporte(
      '50000000-0000-4000-8000-000000000001',
      {
        emisorNombre: 'Churrascaria',
        emisorId: '12345678000190',
        adquirienteId: '79123456',
        numeroDocumento: '445',
        fecha: f('2026-11-03'),
        total: Money.of(300, 'BRL'),
        claveFiscal: null,
        medioPago: 'TARJETA',
        ultimos4Tarjeta: '4321',
        paisCodigo: 'BR',
        categoria: 'ALIMENTACION',
        lineas: [
          { descripcion: 'Rodízio', valor: Money.of(270, 'BRL') },
          { descripcion: 'Caipirinha', valor: Money.of(30, 'BRL') },
        ],
        propinaSugerida: null,
        tasa: new TasaCambio('BRL', 'USD', '0.2', f('2026-11-03'), 'PRUEBA'),
      },
      { nitEmpresa: '900123456', reglas: EXCLUSIONES_POR_DEFECTO.map((c) => new ReglaExclusion(c)), duplicidad: { veredicto: 'UNICO', detalle: null } },
      ahora,
    );
    a.enviarARevision('u-viajero', ahora);
    a.decidirSoporte('50000000-0000-4000-8000-000000000001', { aplica: true, comentario: 'Ok', contadorId: 'u-contabilidad' }, ahora);
    await repo.guardar(a);

    const b = (await repo.obtenerPorAnticipo('40000000-0000-4000-8000-000000000001'))!;
    expect(b.estado).toBe('EN_REVISION');
    expect(b.resumen().totalAceptado.toDto()).toEqual({ monto: '54.00', moneda: 'USD' }); // 270 × 0.2
    const s = b.soporte('50000000-0000-4000-8000-000000000001');
    expect(s.datos!.fecha.toString()).toBe('2026-11-03');
    expect(s.datos!.lineas.map((x) => [x.tipo, x.motivoExclusion])).toEqual([
      ['GASTO', null],
      ['GASTO', 'Bebidas alcohólicas'],
    ]);
    expect(s.decision).toMatchObject({ aplica: true, contadorId: 'u-contabilidad' });
    expect(s.decision!.decididoEn).toBeInstanceOf(Date);
    expect(b.historial[0]!.en).toBeInstanceOf(Date);
    expect((await repo.listarPorEstados(['EN_REVISION'])).map((x) => x.id)).toContain(l.id);
    expect(await repo.listarSoportesProcesando()).toEqual([]);

    // Concurrencia optimista
    const c1 = (await repo.obtenerPorId(l.id))!;
    const c2 = (await repo.obtenerPorId(l.id))!;
    c1.aprobar('u-contabilidad', ahora);
    await repo.guardar(c1);
    c2.devolver('u-contabilidad', 'Rechazo simultáneo', ahora);
    await expect(repo.guardar(c2)).rejects.toMatchObject({ codigo: 'CONFLICTO_CONCURRENCIA' });
  });

  it('eliminar un soporte lo borra de la base', async () => {
    const repo = new LegalizacionRepositoryDrizzle(conexion.db);
    const l = Legalizacion.abrir({
      id: '30000000-0000-4000-8000-000000000002',
      anticipoId: '40000000-0000-4000-8000-000000000002',
      viajeroId: 'u-viajero',
      montoAnticipo: Money.of(100, 'USD'),
      viaje: { inicio: f('2026-11-02'), fin: f('2026-11-06') },
      ahora,
    });
    l.agregarFactura({ soporteId: '50000000-0000-4000-8000-000000000002', descripcion: 'Almuerzo', archivo, ahora });
    l.agregarFactura({ soporteId: '50000000-0000-4000-8000-000000000003', descripcion: 'Taxi al hotel', archivo, ahora });
    await repo.guardar(l);
    const a = (await repo.obtenerPorId(l.id))!;
    a.eliminarSoporte('50000000-0000-4000-8000-000000000002', ahora);
    await repo.guardar(a);
    expect((await repo.obtenerPorId(l.id))!.soportes.map((s) => s.id)).toEqual(['50000000-0000-4000-8000-000000000003']);
  });

  it('la política se lee de la semilla y contabilidad la actualiza', async () => {
    const repo = new PoliticaLegalizacionDrizzle(conexion.db);
    const inicial = await repo.obtener();
    expect(inicial.topesReciboCaja.map((t) => t.toString())).toEqual(['50.00 USD', '200000.00 COP']);
    await repo.guardar({ ...inicial, topesReciboCaja: inicial.topesReciboCaja.slice(0, 1), actualizadaPor: 'u-contabilidad', actualizadaEn: ahora });
    const leida = await repo.obtener();
    expect(leida.topesReciboCaja.map((t) => t.toString())).toEqual(['50.00 USD']);
    expect(leida.actualizadaPor).toBe('u-contabilidad');
  });
});
