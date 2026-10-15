import { beforeEach, describe, expect, it } from 'vitest';
import { FechaCalendario } from '@viaticos/shared-kernel';
import { ColaTrabajosEnProceso } from '../../../shared/infrastructure/cola-trabajos-en-proceso';
import { ProveedorTasaCambioFija } from '../../../shared/infrastructure/proveedor-tasa-cambio-fija';
import { ControlDuplicados } from '../../comprobantes/application/control-duplicados';
import { DetectorDuplicados } from '../../comprobantes/domain/duplicados/detector-duplicados';
import { HuellaRepositoryEnMemoria } from '../../comprobantes/infrastructure/huella.repository.memoria';
import type { DatosExtraidos } from '../domain/tipos';
import { ControlDuplicadosAdapter } from '../infrastructure/adaptadores-modulos';
import { LegalizacionRepositoryEnMemoria, PoliticaLegalizacionEnMemoria } from '../infrastructure/repositorios.memoria';
import { GestionLegalizaciones, type DatosConfirmacion } from './legalizaciones.use-cases';
import type { AlmacenArchivos, ExtractorComprobantes } from './puertos';

const reloj = { ahora: () => new Date('2026-11-10T15:00:00Z'), hoy: () => FechaCalendario.of('2026-11-10') };
let n = 0;
const ids = { nuevo: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
const jpeg = (semilla: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, semilla, 1, 2, 3]);

class AlmacenEnMemoria implements AlmacenArchivos {
  archivos = new Map<string, Buffer>();
  async guardar(c: string, b: Buffer) {
    this.archivos.set(c, b);
  }
  async leer(c: string) {
    return this.archivos.get(c)!;
  }
  async eliminar(c: string) {
    this.archivos.delete(c);
  }
}

const lectura: DatosExtraidos = {
  tipoDocumento: 'FACTURA_ELECTRONICA',
  emisorNombre: 'Restaurante Sabor',
  emisorId: '800111222-1',
  adquirienteNombre: 'Empresa SAS',
  adquirienteId: '900123456-7',
  numeroDocumento: 'FE-77',
  fecha: '2026-11-03',
  moneda: 'BRL',
  total: '250.00',
  claveFiscal: null,
  medioPago: 'TARJETA',
  ultimos4Tarjeta: '4321',
  paisCodigo: 'BR',
  categoriaSugerida: 'ALIMENTACION',
  lineas: [
    { descripcion: 'Picanha', valor: '200.00' },
    { descripcion: 'Cerveja', valor: '50.00' },
  ],
  confianza: 'ALTA',
  observaciones: null,
};

const confirmacionDesde = (d: DatosExtraidos): DatosConfirmacion => ({
  emisorNombre: d.emisorNombre!,
  emisorId: d.emisorId,
  adquirienteId: d.adquirienteId,
  numeroDocumento: d.numeroDocumento,
  fecha: d.fecha!,
  moneda: d.moneda!,
  total: d.total!,
  claveFiscal: d.claveFiscal,
  medioPago: d.medioPago,
  ultimos4Tarjeta: d.ultimos4Tarjeta,
  paisCodigo: d.paisCodigo!,
  categoria: d.categoriaSugerida,
  lineas: d.lineas,
});

describe('GestionLegalizaciones', () => {
  let gestion: GestionLegalizaciones;
  let cola: ColaTrabajosEnProceso;
  let almacen: AlmacenEnMemoria;
  let extractor: ExtractorComprobantes;
  let legalizacionId: string;

  beforeEach(async () => {
    cola = new ColaTrabajosEnProceso();
    almacen = new AlmacenEnMemoria();
    extractor = { automatico: true, extraer: async () => lectura };
    gestion = new GestionLegalizaciones(
      new LegalizacionRepositoryEnMemoria(),
      new PoliticaLegalizacionEnMemoria(),
      almacen,
      { automatico: true, extraer: (e) => extractor.extraer(e) },
      cola,
      new ControlDuplicadosAdapter(new ControlDuplicados(new HuellaRepositoryEnMemoria(), new DetectorDuplicados())),
      new ProveedorTasaCambioFija('COP=4000,BRL=5'),
      ids,
      reloj,
      { publicar: async () => undefined },
      { advertencia: () => undefined },
    );
    const l = await gestion.abrirParaAnticipo({
      anticipoId: '10000000-0000-4000-8000-000000000001',
      viajeroId: 'ana',
      monto: { monto: '475.00', moneda: 'USD' },
      viajeInicio: '2026-11-02',
      viajeFin: '2026-11-06',
    });
    legalizacionId = l.id;
  });

  const subir = (semilla = 1, usuarioId = 'ana') =>
    gestion.subirFactura({ legalizacionId, usuarioId, descripcion: 'Cena con el cliente', archivo: { nombre: 'f.jpg', contenido: jpeg(semilla) } });

  it('abrir es idempotente por anticipo', async () => {
    const otra = await gestion.abrirParaAnticipo({
      anticipoId: '10000000-0000-4000-8000-000000000001',
      viajeroId: 'ana',
      monto: { monto: '475.00', moneda: 'USD' },
      viajeInicio: '2026-11-02',
      viajeFin: '2026-11-06',
    });
    expect(otra.id).toBe(legalizacionId);
  });

  it('sube la foto, la guarda y la lectura automática deja el soporte por confirmar', async () => {
    const l = await subir();
    const soporte = l.soportes[0]!;
    expect(soporte.estado).toBe('PROCESANDO');
    expect(almacen.archivos.size).toBe(1);
    await cola.esperarInactividad();
    const leida = await gestion.obtenerPara(legalizacionId, 'ana', []);
    expect(leida.soporte(soporte.id)).toMatchObject({ estado: 'POR_CONFIRMAR', extraccion: { emisorNombre: 'Restaurante Sabor' } });
  });

  it('si la lectura automática falla, queda para digitación manual (no bloquea)', async () => {
    extractor = { automatico: true, extraer: async () => Promise.reject(new Error('timeout')) };
    const l = await subir();
    await cola.esperarInactividad();
    const s = (await gestion.obtenerPara(legalizacionId, 'ana', [])).soporte(l.soportes[0]!.id);
    expect(s).toMatchObject({ estado: 'POR_CONFIRMAR', extraccion: null, alertas: [{ codigo: 'LECTURA_NO_DISPONIBLE' }] });
  });

  it('confirma en BRL: excluye la cerveja y convierte a USD (250 − 50 = 200 BRL = 40 USD)', async () => {
    const soporteId = (await subir()).soportes[0]!.id;
    await cola.esperarInactividad();
    const l = await gestion.confirmarSoporte({ legalizacionId, soporteId, usuarioId: 'ana', soporte: confirmacionDesde(lectura) });
    expect(l.resumen().totalAceptado.toDto()).toEqual({ monto: '40.00', moneda: 'USD' });
    expect(l.resumen().totalExcluido.toDto()).toEqual({ monto: '10.00', moneda: 'USD' });
    expect(l.soporte(soporteId).alertas.map((a) => a.codigo)).toEqual(['SIN_CLAVE_FISCAL', 'LINEAS_EXCLUIDAS']);
  });

  it('rechaza el mismo archivo dos veces antes de guardar o leerlo', async () => {
    await subir(7);
    await expect(subir(7)).rejects.toMatchObject({ codigo: 'COMPROBANTE_DUPLICADO' });
    expect(almacen.archivos.size).toBe(1);
  });

  it('bloquea al confirmar una factura ya legalizada (mismo emisor y número, otra foto)', async () => {
    const a = (await subir(1)).soportes[0]!.id;
    const b = (await subir(2)).soportes[1]!.id;
    await cola.esperarInactividad();
    await gestion.confirmarSoporte({ legalizacionId, soporteId: a, usuarioId: 'ana', soporte: confirmacionDesde(lectura) });
    await expect(
      gestion.confirmarSoporte({ legalizacionId, soporteId: b, usuarioId: 'ana', soporte: confirmacionDesde(lectura) }),
    ).rejects.toMatchObject({ codigo: 'COMPROBANTE_DUPLICADO' });
  });

  it('al eliminar un soporte se libera su huella y su archivo', async () => {
    const soporteId = (await subir(3)).soportes[0]!.id;
    await cola.esperarInactividad();
    await gestion.eliminarSoporte({ legalizacionId, soporteId, usuarioId: 'ana' });
    expect(almacen.archivos.size).toBe(0);
    await expect(subir(3)).resolves.toBeDefined();
  });

  it('recibo de caja: tope en la moneda del anticipo cuando no hay tope en la del recibo', async () => {
    const recibo = (valor: string) =>
      gestion.agregarReciboCaja({
        legalizacionId,
        usuarioId: 'ana',
        archivo: null,
        recibo: { descripcion: 'Taxi informal', fecha: '2026-11-03', moneda: 'BRL', valor, categoria: 'TRANSPORTE', medioPago: 'EFECTIVO', paisCodigo: 'BR' },
      });
    // Tope 50 USD = 250 BRL
    await expect(recibo('260')).rejects.toMatchObject({ codigo: 'TOPE_RECIBO_EXCEDIDO' });
    const l = await recibo('100');
    expect(l.resumen().totalAceptado.toDto()).toEqual({ monto: '20.00', moneda: 'USD' });
  });

  it('otra persona no puede subir soportes a la legalización de un viajero', async () => {
    await expect(subir(9, 'carlos')).rejects.toMatchObject({ codigo: 'LEGALIZACION_NO_ENCONTRADA' });
  });

  it('reanuda las lecturas que quedaron pendientes tras un reinicio', async () => {
    extractor = { automatico: true, extraer: () => new Promise(() => undefined) }; // nunca termina
    await subir(4);
    expect(await gestion.reanudarPendientes()).toBe(1);
  });

  it('la política la actualiza contabilidad (un tope por moneda)', async () => {
    await expect(
      gestion.actualizarPolitica({
        contadorId: 'laura',
        nitEmpresa: '900123456',
        topesReciboCaja: [{ monto: '10', moneda: 'USD' }, { monto: '20', moneda: 'USD' }],
        exclusiones: [],
      }),
    ).rejects.toMatchObject({ codigo: 'TOPE_DUPLICADO' });
    const p = await gestion.actualizarPolitica({
      contadorId: 'laura',
      nitEmpresa: '900123456',
      topesReciboCaja: [{ monto: '80', moneda: 'USD' }],
      exclusiones: [{ codigo: 'LICOR', nombre: 'Licor', palabras: [' vino ', 'vino', ''] }],
    });
    expect(p.exclusiones[0]!.palabras).toEqual(['vino']);
  });
});
