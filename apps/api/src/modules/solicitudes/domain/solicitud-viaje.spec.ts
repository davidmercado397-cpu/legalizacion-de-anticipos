import { describe, expect, it } from 'vitest';
import { tarifasBrasil } from '../test-support/fabricas';
import { Destino } from './destino';
import { ExcedeTarifaRegla } from './escalamiento/excede-tarifa.regla';
import { evaluarEscalamiento } from './escalamiento/regla-escalamiento';
import { estimarPresupuesto } from './presupuesto-viaje';
import { SolicitudViaje } from './solicitud-viaje';

const ahora = new Date('2026-10-15T15:00:00Z');
const aprobadores = { viajeroId: 'v', jefeInmediatoId: 'j', jefeDirectivoId: 'd' };

function nuevaSolicitud(valorHotel: string, justificacion: string | null = null) {
  const destinos = [Destino.crear({ paisCodigo: 'BR', ciudad: 'Rio', fechaInicio: '2026-11-02', fechaFin: '2026-11-06' })];
  const presupuesto = estimarPresupuesto({
    monedaAnticipo: 'USD',
    destinos: [{ destino: destinos[0]!, tarifas: tarifasBrasil(), valoresSolicitados: new Map([['ALOJAMIENTO', valorHotel]]) }],
    tasas: [],
  });
  return SolicitudViaje.crear({
    id: 's1',
    aprobadores,
    motivo: 'Visita técnica a cliente en Rio',
    justificacion,
    destinos,
    presupuesto,
    escalamiento: evaluarEscalamiento(presupuesto, [new ExcedeTarifaRegla()]),
    ahora,
  });
}

describe('SolicitudViaje', () => {
  it('se crea en aprobación y notifica al primer aprobador', () => {
    const s = nuevaSolicitud('30');
    expect(s.estado).toBe('EN_APROBACION');
    expect(s.extraerEventos()).toEqual([
      expect.objectContaining({ tipo: 'solicitudes.SolicitudEnviada', aprobadorId: 'j', requiereJefeDirectivo: false }),
    ]);
  });

  it('exige justificación cuando escala a jefe directivo', () => {
    expect(() => nuevaSolicitud('50')).toThrowError(/justifique/);
    expect(nuevaSolicitud('50', 'Único hotel cerca del cliente').ruta.pasosSnapshot).toHaveLength(2);
  });

  it('queda aprobada al completar la ruta y emite SolicitudAprobada con el total', () => {
    const s = nuevaSolicitud('50', 'Único hotel cerca del cliente');
    s.extraerEventos();
    s.aprobar('j', ahora);
    expect(s.estado).toBe('EN_APROBACION');
    s.aprobar('d', ahora, 'De acuerdo');
    expect(s.estado).toBe('APROBADA');
    expect(s.extraerEventos().map((e) => e.tipo)).toEqual([
      'solicitudes.AprobacionRegistrada',
      'solicitudes.AprobacionRegistrada',
      'solicitudes.SolicitudAprobada',
    ]);
  });

  it('el rechazo es definitivo', () => {
    const s = nuevaSolicitud('30');
    s.rechazar('j', ahora, 'No hay presupuesto este mes');
    expect(s.estado).toBe('RECHAZADA');
    expect(() => s.aprobar('j', ahora)).toThrowError(/RECHAZADA/);
  });

  it('solo el viajero puede cancelar, y solo mientras está en aprobación', () => {
    const s = nuevaSolicitud('30');
    expect(() => s.cancelar('j', ahora)).toThrowError(/Solo el viajero/);
    s.cancelar('v', ahora);
    expect(s.estado).toBe('CANCELADA');
  });

  it('el snapshot no comparte estado mutable con el agregado', () => {
    const s = nuevaSolicitud('30');
    const snapshot = s.toSnapshot();
    s.aprobar('j', ahora);
    expect(snapshot.ruta.pasoActual()?.estado).toBe('PENDIENTE');
  });

  it('solo el viajero y sus aprobadores pueden verla', () => {
    const s = nuevaSolicitud('30');
    expect(s.puedeSerVistaPor('v')).toBe(true);
    expect(s.puedeSerVistaPor('j')).toBe(true);
    expect(s.puedeSerVistaPor('otro')).toBe(false);
  });
});
