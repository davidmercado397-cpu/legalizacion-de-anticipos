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
  });

  const viaje = (valorHotel?: string) => ({
    monedaAnticipo: 'USD',
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

  it('sin autenticación responde 401 en formato problem+json', async () => {
    const r = await request(app.getHttpServer()).post('/api/v1/solicitudes/estimar').send(viaje());
    expect(r.status).toBe(401);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body.code).toBe('NO_AUTENTICADO');
  });

  it('valida la entrada con los contratos compartidos (400 + errores por campo)', async () => {
    const r = await como('u-viajero').post('/solicitudes/estimar').send({ monedaAnticipo: 'EUR', destinos: [] });
    expect(r.status).toBe(400);
    expect(r.body.errors).toMatchObject({
      monedaAnticipo: ['validation.currency'],
      destinos: ['validation.atLeastOneDestination'],
    });
  });

  it('estima un viaje y avisa que escalará si el hotel supera la tarifa', async () => {
    const r = await como('u-viajero').post('/solicitudes/estimar').send(viaje('50')).expect(200);
    expect(r.body.presupuesto.totalAnticipo).toEqual({ monto: '475.00', moneda: 'USD' }); // 4×50 + 5×35 + 5×20
    expect(r.body.escalamiento.requiereJefeDirectivo).toBe(true);
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

    await como('u-directivo').post(`/solicitudes/${id}/aprobar`).send({}).expect(403);
    const pendientes = await como('u-jefe').get('/aprobaciones/pendientes').expect(200);
    expect(pendientes.body.map((s: { id: string }) => s.id)).toContain(id);

    await como('u-jefe').post(`/solicitudes/${id}/aprobar`).send({}).expect(200);
    const final = await como('u-directivo').post(`/solicitudes/${id}/aprobar`).send({ comentario: 'OK' }).expect(200);
    expect(final.body.estado).toBe('APROBADA');

    await como('u-contabilidad').get(`/solicitudes/${id}`).expect(404);
  });

  it('detecta duplicados sin revelar a otros viajeros', async () => {
    const r = await como('u-viajero')
      .post('/comprobantes/duplicados/verificar')
      .send({ sha256: 'a'.repeat(64) })
      .expect(200);
    expect(r.body).toEqual({ veredicto: 'UNICO', coincidencias: [] });
  });
});
