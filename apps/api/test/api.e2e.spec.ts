import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { cargarConfiguracion } from '../src/shared/configuracion';

describe('API HTTP (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule.forRoot(cargarConfiguracion({ NODE_ENV: 'test', PERSISTENCIA: 'memoria', AUTH_MODE: 'dev', TRM_DESARROLLO: '4000' }))],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const como = (usuario: string) => ({
    post: (url: string) => request(app.getHttpServer()).post(`/api/v1${url}`).set('x-usuario-id', usuario),
    get: (url: string) => request(app.getHttpServer()).get(`/api/v1${url}`).set('x-usuario-id', usuario),
    put: (url: string) => request(app.getHttpServer()).put(`/api/v1${url}`).set('x-usuario-id', usuario),
  });

  const viaje = (valorHotel?: string) => ({
    destinos: [
      {
        paisCodigo: 'br',
        ciudad: 'São Paulo',
        fechaInicio: '2026-11-02',
        fechaFin: '2026-11-06',
        valoresSolicitados: valorHotel ? [{ conceptoCodigo: 'ALOJAMIENTO', valorUnitario: valorHotel }] : [],
      },
    ],
  });

  it('salud es pública', async () => {
    await request(app.getHttpServer()).get('/api/v1/salud').expect(200, { estado: 'ok' });
  });

  it('muestra las tasas del día con su fuente', async () => {
    const r = await como('u-viajero').get('/tasas').expect(200);
    expect(r.body.cotizaciones).toContainEqual({ moneda: 'COP', porDolar: '4000', fuente: 'TASA_DESARROLLO' });
    await como('u-viajero').get('/tasas?fecha=ayer').expect(400);
  });

  it('sin autenticación responde 401 en formato problem+json', async () => {
    const r = await request(app.getHttpServer()).post('/api/v1/solicitudes/estimar').send(viaje());
    expect(r.status).toBe(401);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body.code).toBe('NO_AUTENTICADO');
  });

  it('valida la entrada con los contratos compartidos (400 + errores por campo)', async () => {
    const r = await como('u-viajero').post('/solicitudes/estimar').send({ destinos: [] });
    expect(r.status).toBe(400);
    expect(r.body.errors).toMatchObject({ destinos: ['validation.atLeastOneDestination'] });
  });

  it('estima un viaje y avisa que escalará si el hotel supera la tarifa', async () => {
    const r = await como('u-viajero').post('/solicitudes/estimar').send(viaje('50')).expect(200);
    expect(r.body.presupuesto.totalAnticipo).toEqual({ monto: '475.00', moneda: 'USD' }); // 4×50 + 5×35 + 5×20
    expect(r.body.escalamiento.requiereJefeDirectivo).toBe(true);
  });

  it('contabilidad configura cuándo se escala al directivo (tolerancia de 10 % por defecto)', async () => {
    const actual = await como('u-viajero').get('/configuracion-escalamiento').expect(200);
    expect(actual.body.excedeTarifa).toEqual({ activa: true, toleranciaPorcentaje: 10 });
    // Hotel a 33 USD con tarifa de 30: dentro del 10 %, no escala
    expect((await como('u-viajero').post('/solicitudes/estimar').send(viaje('33')).expect(200)).body.escalamiento.requiereJefeDirectivo).toBe(false);

    const nueva = { ...actual.body, excedeTarifa: { activa: true, toleranciaPorcentaje: 0 } };
    await como('u-viajero').put('/configuracion-escalamiento').send(nueva).expect(403);
    const guardada = await como('u-contabilidad').put('/configuracion-escalamiento').send(nueva).expect(200);
    expect(guardada.body).toMatchObject({ excedeTarifa: { toleranciaPorcentaje: 0 }, actualizadoPorNombre: 'Laura Contable' });
    expect((await como('u-viajero').post('/solicitudes/estimar').send(viaje('33')).expect(200)).body.escalamiento.requiereJefeDirectivo).toBe(true);

    await como('u-contabilidad').put('/configuracion-escalamiento').send({ ...nueva, excedeTarifa: { activa: true, toleranciaPorcentaje: 150 } }).expect(400);
    await como('u-contabilidad').put('/configuracion-escalamiento').send(actual.body).expect(200);
  });

  it('errores de dominio → 422 con código estable', async () => {
    const r = await como('u-viajero')
      .post('/solicitudes')
      .send({ ...viaje('50'), motivo: 'Implementación en cliente' })
      .expect(422);
    expect(r.body.code).toBe('JUSTIFICACION_REQUERIDA');
  });

  it('flujo completo: crear → jefe aprueba → directivo aprueba', async () => {
    const creada = await como('u-viajero')
      .post('/solicitudes')
      .send({ ...viaje('50'), motivo: 'Implementación en cliente', justificacion: 'Hotel junto al cliente' })
      .expect(201);
    const id = creada.body.id as string;
    expect(creada.body.ruta.map((p: { aprobadorId: string }) => p.aprobadorId)).toEqual(['u-jefe', 'u-directivo']);
    expect(creada.body.viajeroNombre).toBe('Ana Viajera');
    expect(creada.body.ruta.map((p: { aprobadorNombre: string }) => p.aprobadorNombre)).toEqual(['Carlos Jefe', 'Diana Directiva']);

    await como('u-tesoreria').post(`/solicitudes/${id}/aprobar`).send({}).expect(403);
    // El jefe inmediato tiene el turno, pero el directivo también la ve: puede aprobar sin esperar.
    for (const aprobador of ['u-jefe', 'u-directivo']) {
      const pendientes = await como(aprobador).get('/aprobaciones/pendientes').expect(200);
      expect(pendientes.body.map((s: { id: string }) => s.id)).toContain(id);
    }

    await como('u-jefe').post(`/solicitudes/${id}/aprobar`).send({}).expect(200);
    const final = await como('u-directivo').post(`/solicitudes/${id}/aprobar`).send({ comentario: 'OK' }).expect(200);
    expect(final.body.estado).toBe('APROBADA');

    // Directo del directivo: el paso del jefe inmediato queda omitido.
    const otra = await como('u-viajero')
      .post('/solicitudes')
      .send({ ...viaje('50'), motivo: 'Segunda visita al cliente', justificacion: 'Hotel junto al cliente' })
      .expect(201);
    const directa = await como('u-directivo').post(`/solicitudes/${otra.body.id}/aprobar`).send({}).expect(200);
    expect(directa.body.estado).toBe('APROBADA');
    expect(directa.body.ruta.map((p: { estado: string }) => p.estado)).toEqual(['OMITIDO', 'APROBADO']);

    // Los viajes de la directiva (sin jefe) los aprueba la gerencia.
    const deDiana = await como('u-directivo')
      .post('/solicitudes')
      .send({ ...viaje(), motivo: 'Comité con el cliente en São Paulo' })
      .expect(201);
    expect(deDiana.body.ruta.map((p: { nivel: string; aprobadorId: string }) => `${p.nivel}:${p.aprobadorId}`)).toEqual(['GERENCIA:u-gerencia']);

    await como('u-contabilidad').get(`/solicitudes/${id}`).expect(404);

    // La aprobación final crea el anticipo (registrado en el ERP simulado)
    const anticipo = (await como('u-viajero').get('/anticipos/mios').expect(200)).body.find((a: { solicitudId: string }) => a.solicitudId === id);
    expect(anticipo).toMatchObject({ solicitudId: id, estado: 'POR_DESEMBOLSAR', monto: { monto: '475.00', moneda: 'USD' } });
    expect(anticipo.viaje).toMatchObject({ fechaInicio: '2026-11-02', fechaFin: '2026-11-06' });

    // Solo tesorería ve la bandeja y registra el desembolso
    await como('u-viajero').get('/anticipos').expect(403);
    const bandeja = await como('u-tesoreria').get('/anticipos').expect(200);
    expect(bandeja.body.map((a: { id: string }) => a.id)).toContain(anticipo.id);
    await como('u-viajero').post(`/anticipos/${anticipo.id}/desembolso`).send({ fecha: '2026-10-15', medio: 'TRANSFERENCIA' }).expect(403);
    const pagado = await como('u-tesoreria')
      .post(`/anticipos/${anticipo.id}/desembolso`)
      .send({ fecha: '2026-10-15', medio: 'TRANSFERENCIA', referencia: 'TR-889' })
      .expect(200);
    expect(pagado.body).toMatchObject({ estado: 'DESEMBOLSADO', desembolso: { medio: 'TRANSFERENCIA', registradoPor: 'Tomás Tesorero' } });
  });

  it('detecta duplicados sin revelar a otros viajeros', async () => {
    const r = await como('u-viajero')
      .post('/comprobantes/duplicados/verificar')
      .send({ sha256: 'a'.repeat(64) })
      .expect(200);
    expect(r.body).toEqual({ veredicto: 'UNICO', coincidencias: [] });
  });
});
