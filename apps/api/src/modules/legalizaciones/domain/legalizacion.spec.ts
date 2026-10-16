import { describe, expect, it } from 'vitest';
import { FechaCalendario, Money, TasaCambio } from '@viaticos/shared-kernel';
import { Legalizacion, type ContextoConfirmacion } from './legalizacion';
import { EXCLUSIONES_POR_DEFECTO, ReglaExclusion } from './reglas-exclusion';
import type { DatosSoporte } from './tipos';

const f = FechaCalendario.of;
const ahora = new Date('2026-11-10T15:00:00Z');
const NIT = '900.123.456-7';
const archivo = { clave: 'k', nombre: 'f.jpg', mime: 'image/jpeg', tamano: 100, sha256: 'a'.repeat(64) };
const contexto = (cambios: Partial<ContextoConfirmacion> = {}): ContextoConfirmacion => ({
  nitEmpresa: NIT,
  reglas: EXCLUSIONES_POR_DEFECTO.map((c) => new ReglaExclusion(c)),
  duplicidad: { veredicto: 'UNICO', detalle: null },
  ...cambios,
});

function nueva(moneda = 'USD', monto = 475) {
  return Legalizacion.abrir({
    id: 'l1',
    anticipoId: 'a1',
    viajeroId: 'ana',
    montoAnticipo: Money.of(monto, moneda),
    viaje: { inicio: f('2026-11-02'), fin: f('2026-11-06') },
    ahora,
  });
}

const datos = (cambios: Partial<DatosSoporte> = {}): DatosSoporte => ({
  emisorNombre: 'Restaurante El Cielo',
  emisorId: '800111222',
  adquirienteId: '900123456',
  numeroDocumento: 'FE-10',
  fecha: f('2026-11-03'),
  total: Money.of(100, 'USD'),
  claveFiscal: null,
  medioPago: 'TARJETA',
  ultimos4Tarjeta: '1234',
  paisCodigo: 'US',
  categoria: 'ALIMENTACION',
  lineas: [],
  tasa: null,
  ...cambios,
});

function conFactura(l = nueva(), id = 's1') {
  l.agregarFactura({ soporteId: id, descripcion: 'Cena con el cliente', archivo, ahora });
  l.registrarExtraccion(id, null, ahora);
  return l;
}

const lineas = (...items: Array<[string, number]>) =>
  items.map(([descripcion, valor]) => ({ descripcion, valor: Money.of(valor, 'USD'), excluida: false, motivoExclusion: null }));

describe('Legalizacion · facturas', () => {
  it('la factura pasa por PROCESANDO → POR_CONFIRMAR → CONFIRMADO', () => {
    const l = nueva();
    l.agregarFactura({ soporteId: 's1', descripcion: 'Almuerzo de trabajo', archivo, ahora });
    expect(l.soporte('s1').estado).toBe('PROCESANDO');
    l.registrarExtraccion('s1', null, ahora);
    expect(l.soporte('s1')).toMatchObject({ estado: 'POR_CONFIRMAR', alertas: [{ codigo: 'LECTURA_NO_DISPONIBLE' }] });
    l.confirmarSoporte('s1', datos(), contexto(), ahora);
    expect(l.soporte('s1').estado).toBe('CONFIRMADO');
    expect(l.soporte('s1').alertas).toEqual([]);
  });

  it('exige una descripción de para qué fue la compra', () => {
    expect(() => nueva().agregarFactura({ soporteId: 's1', descripcion: 'x', archivo, ahora })).toThrowError(/Describa/);
  });

  it('excluye por línea el licor y legaliza el resto (total − excluido)', () => {
    const l = conFactura();
    l.confirmarSoporte('s1', datos({ total: Money.of(110, 'USD'), lineas: lineas(['Bandeja paisa', 80], ['2 Cerveza Club', 20]) }), contexto(), ahora);
    const s = l.soporte('s1');
    expect(s.datos!.lineas.map((x) => x.excluida)).toEqual([false, true]);
    expect(s.alertas.map((a) => a.codigo)).toEqual(['LINEAS_EXCLUIDAS', 'TOTAL_NO_CUADRA']);
    // 110 − 20 = 90 (los 10 de diferencia son propina/impuesto y se reconocen)
    expect(l.resumen()).toMatchObject({
      totalAceptado: Money.of(90, 'USD'),
      totalExcluido: Money.of(20, 'USD'),
      saldo: Money.of(385, 'USD'),
    });
  });

  it('alerta para contabilidad si la factura no está a nombre de la empresa (NIT normalizado)', () => {
    const l = conFactura();
    l.confirmarSoporte('s1', datos({ adquirienteId: '900123456-7' }), contexto(), ahora);
    expect(l.soporte('s1').alertas).toEqual([]);
    l.confirmarSoporte('s1', datos({ adquirienteId: '1020304050' }), contexto(), ahora);
    expect(l.soporte('s1').alertas).toEqual([expect.objectContaining({ codigo: 'NO_A_NOMBRE_EMPRESA', severidad: 'REVISION' })]);
  });

  it('marca fechas fuera del viaje (con un día de margen) y posibles duplicados', () => {
    const l = conFactura();
    l.confirmarSoporte('s1', datos({ fecha: f('2026-11-07') }), contexto(), ahora);
    expect(l.soporte('s1').alertas).toEqual([]);
    l.confirmarSoporte(
      's1',
      datos({ fecha: f('2026-10-20') }),
      contexto({ duplicidad: { veredicto: 'SOSPECHOSO', detalle: 'Mismo emisor, fecha y total' } }),
      ahora,
    );
    expect(l.soporte('s1').alertas.map((a) => a.codigo)).toEqual(['POSIBLE_DUPLICADO', 'FECHA_FUERA_DEL_VIAJE']);
  });

  it('una factura colombiana sin CUFE exige la decisión de contabilidad', () => {
    const l = conFactura(nueva('COP', 1_000_000));
    l.confirmarSoporte('s1', datos({ paisCodigo: 'CO', total: Money.of(85_000, 'COP') }), contexto(), ahora);
    expect(l.soporte('s1').alertas).toEqual([expect.objectContaining({ codigo: 'SIN_CLAVE_FISCAL', severidad: 'REVISION' })]);
  });

  it('convierte a la moneda del anticipo con la tasa del soporte', () => {
    const l = conFactura();
    const tasa = new TasaCambio('BRL', 'USD', '0.2', f('2026-11-03'), 'TRM');
    l.confirmarSoporte('s1', datos({ total: Money.of(250, 'BRL'), paisCodigo: 'BR', claveFiscal: { tipo: 'CHAVE_ACESSO_BR', valor: 'x' }, tasa }), contexto(), ahora);
    expect(l.resumen().totalAceptado).toEqual(Money.of(50, 'USD'));
  });

  it('exige la tasa cuando la moneda del soporte es distinta a la del anticipo', () => {
    const l = conFactura();
    expect(() => l.confirmarSoporte('s1', datos({ total: Money.of(250, 'BRL') }), contexto(), ahora)).toThrowError(/Falta la tasa/);
  });
});

describe('Legalizacion · recibo de caja (proveedor 222)', () => {
  const recibo = (valor: number, tope = 50) => ({
    soporteId: 'r1',
    descripcion: 'Taxi informal al hotel',
    fecha: f('2026-11-02'),
    valor: Money.of(valor, 'USD'),
    categoria: 'TRANSPORTE' as const,
    medioPago: 'EFECTIVO' as const,
    paisCodigo: 'BR',
    beneficiario: 'Conductor',
    archivo: null,
    tasa: null,
    tope: { tope: Money.of(tope, 'USD'), valorEnMonedaTope: Money.of(valor, 'USD') },
    ahora,
  });

  it('se registra confirmado con el tercero 222', () => {
    const l = nueva();
    const s = l.agregarReciboCaja(recibo(30));
    expect(s).toMatchObject({ tipo: 'RECIBO_CAJA', estado: 'CONFIRMADO', datos: { emisorId: '222' } });
    expect(s.alertas.map((a) => a.codigo)).toEqual(['RECIBO_CAJA_222']);
    expect(l.resumen().totalAceptado).toEqual(Money.of(30, 'USD'));
  });

  it('respeta el tope configurado por contabilidad', () => {
    expect(() => nueva().agregarReciboCaja(recibo(60))).toThrowError(/no puede superar 50.00 USD/);
  });
});

describe('Legalizacion · flujo de revisión', () => {
  function enviada() {
    const l = conFactura();
    l.confirmarSoporte('s1', datos({ adquirienteId: null }), contexto(), ahora);
    l.enviarARevision('ana', ahora);
    return l;
  }

  it('no se envía con soportes sin confirmar', () => {
    const l = nueva();
    l.agregarFactura({ soporteId: 's1', descripcion: 'Almuerzo', archivo, ahora });
    expect(() => l.enviarARevision('ana', ahora)).toThrowError(/Confirme/);
  });

  it('contabilidad debe decidir las alertas de revisión antes de aprobar', () => {
    const l = enviada();
    expect(() => l.aprobar('laura', ahora)).toThrowError(/Decida si aplican/);
    expect(() => l.decidirSoporte('s1', { aplica: false, comentario: '', contadorId: 'laura' }, ahora)).toThrowError(/Explique/);
    l.decidirSoporte('s1', { aplica: false, comentario: 'Factura a nombre personal', contadorId: 'laura' }, ahora);
    l.aprobar('laura', ahora);
    expect(l.estado).toBe('APROBADA');
    expect(l.resumen()).toMatchObject({ totalAceptado: Money.of(0, 'USD'), totalExcluido: Money.of(100, 'USD') });
    expect(l.extraerEventos().map((e) => e.tipo)).toEqual(['legalizaciones.LegalizacionAprobada']);
  });

  it('devuelta, el viajero puede corregir y reenviar; ya aprobada no se edita', () => {
    const l = enviada();
    l.devolver('laura', 'Falta la factura del hotel', ahora);
    expect(l.estado).toBe('DEVUELTA');
    l.confirmarSoporte('s1', datos(), contexto(), ahora);
    l.enviarARevision('ana', ahora);
    l.aprobar('laura', ahora);
    expect(() => l.eliminarSoporte('s1', ahora)).toThrowError(/APROBADA/);
  });

  it('nadie revisa su propia legalización', () => {
    expect(() => enviada().aprobar('ana', ahora)).toThrowError(/propia/);
  });

  it('eliminar un soporte emite evento para liberar su huella anti-duplicados', () => {
    const l = conFactura();
    l.eliminarSoporte('s1', ahora);
    expect(l.extraerEventos()).toEqual([expect.objectContaining({ tipo: 'legalizaciones.SoporteEliminado', soporteId: 's1' })]);
  });
});
