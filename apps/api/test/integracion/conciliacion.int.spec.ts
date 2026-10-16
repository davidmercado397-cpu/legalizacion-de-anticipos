import { FechaCalendario, Money } from '@viaticos/shared-kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Extracto } from '../../src/modules/conciliacion/domain/extracto';
import type { PerfilExtracto } from '../../src/modules/conciliacion/domain/perfil-extracto';
import {
  ExtractoRepositoryDrizzle,
  PerfilExtractoRepositoryDrizzle,
} from '../../src/modules/conciliacion/infrastructure/persistencia/extracto.repository.drizzle';
import type { ConexionBaseDatos } from '../../src/shared/infrastructure/base-datos/conexion';
import { URL_PRUEBAS, prepararBaseDePruebas } from './base-de-pruebas';

const ahora = new Date('2026-11-10T15:00:00Z');
const perfil: PerfilExtracto = {
  filaEncabezado: 1,
  columnas: { fecha: 0, descripcion: 1, referencia: null, valor: 2, debito: null, credito: null },
  formatoFecha: 'DD/MM/AAAA',
  separadorDecimal: ',',
  signoCargos: 'NEGATIVO',
  moneda: 'COP',
};
const uuid = (prefijo: string, n: number) => `${prefijo}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SOPORTE = uuid('5', 1);
const LEGALIZACION = uuid('3', 1);

function extracto(n: number) {
  return Extracto.cargar({
    id: uuid('7', n),
    titularId: 'u-viajero',
    legalizacionId: LEGALIZACION,
    ultimos4: '4321',
    moneda: 'COP',
    archivo: { nombre: `extracto-${n}.csv`, sha256: String(n).repeat(64).slice(0, 64) },
    perfil,
    movimientos: [1, 2].map((i) => ({
      id: uuid('8', n * 10 + i),
      fila: i + 1,
      fecha: FechaCalendario.of(`2026-11-0${i + 2}`),
      descripcion: `COMPRA ${i}`,
      referencia: null,
      valor: Money.of('228000', 'COP'),
      tipo: 'DEBITO' as const,
    })),
    cargadoPor: 'u-viajero',
    cargadoEn: ahora,
  });
}
const propuesta = (movimientoId: string) => ({
  movimientoId,
  soporteId: SOPORTE,
  legalizacionId: LEGALIZACION,
  puntaje: 0.86,
  estado: 'AUTOMATICO' as const,
  montoSoporte: Money.of('222222.22', 'COP'),
});

describe.runIf(URL_PRUEBAS)('Conciliación en PostgreSQL (integración)', () => {
  let conexion: ConexionBaseDatos;
  beforeAll(async () => {
    conexion = await prepararBaseDePruebas();
  });
  afterAll(async () => {
    await conexion?.onApplicationShutdown();
  });

  it('persiste movimientos, cruces y rechazos, con concurrencia optimista', async () => {
    const repo = new ExtractoRepositoryDrizzle(conexion.db);
    const e = extracto(1);
    e.aplicarPropuestas([propuesta(uuid('8', 11))], ahora);
    await repo.guardar(e);
    expect(await repo.existeArchivo(e.toSnapshot().archivo.sha256)).toBe(true);

    const leido = (await repo.obtenerPorId(e.id))!;
    expect(leido.movimientos.map((m) => [m.fecha.toString(), m.valor.toDto()])).toEqual([
      ['2026-11-03', { monto: '228000.00', moneda: 'COP' }],
      ['2026-11-04', { monto: '228000.00', moneda: 'COP' }],
    ]);
    expect(leido.cruces).toMatchObject([{ soporteId: SOPORTE, estado: 'AUTOMATICO', puntaje: 0.86, montoSoporte: Money.of('222222.22', 'COP') }]);

    leido.rechazar(uuid('8', 11), ahora);
    await repo.guardar(leido);
    const otraVez = (await repo.obtenerPorId(e.id))!;
    expect(otraVez.cruces).toEqual([]);
    expect(otraVez.paresRechazados()).toEqual(new Set([`${uuid('8', 11)}|${SOPORTE}`]));
    await expect(repo.guardar(leido)).rejects.toMatchObject({ codigo: 'CONFLICTO_CONCURRENCIA' });

    expect((await repo.listarPorTitular('u-viajero')).map((x) => x.id)).toEqual([e.id]);
  });

  it('una factura no se cruza en dos extractos y un archivo no se carga dos veces', async () => {
    const repo = new ExtractoRepositoryDrizzle(conexion.db);
    const a = extracto(2);
    a.aplicarPropuestas([propuesta(uuid('8', 21))], ahora);
    await repo.guardar(a);
    expect(await repo.soportesCruzadosFuera(uuid('7', 3), [SOPORTE])).toEqual(new Set([SOPORTE]));
    expect(await repo.soportesCruzadosFuera(a.id, [SOPORTE])).toEqual(new Set());

    const b = extracto(3);
    b.aplicarPropuestas([propuesta(uuid('8', 31))], ahora);
    await expect(repo.guardar(b)).rejects.toMatchObject({ codigo: 'SOPORTE_YA_CONCILIADO' });

    const copia = Extracto.cargar({ ...extracto(4).toSnapshot(), archivo: a.toSnapshot().archivo });
    await expect(repo.guardar(copia)).rejects.toMatchObject({ codigo: 'EXTRACTO_YA_CARGADO' });
  });

  it('los perfiles se guardan por nombre y se reemplazan', async () => {
    const repo = new PerfilExtractoRepositoryDrizzle(conexion.db);
    await repo.guardar({ id: uuid('9', 1), nombre: 'Banco X débito', perfil, actualizadoPor: 'u-contabilidad', actualizadoEn: ahora });
    await repo.guardar({ id: uuid('9', 2), nombre: 'Banco X débito', perfil: { ...perfil, separadorDecimal: '.' }, actualizadoPor: 'u-contabilidad', actualizadoEn: ahora });
    const perfiles = await repo.listar();
    expect(perfiles).toHaveLength(1);
    expect(perfiles[0]).toMatchObject({ id: uuid('9', 1), perfil: { separadorDecimal: '.' } });
  });
});
