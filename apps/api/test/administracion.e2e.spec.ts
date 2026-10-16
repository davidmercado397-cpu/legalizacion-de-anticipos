import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { cargarConfiguracion } from '../src/shared/configuracion';

describe('Administración (e2e HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule.forRoot(cargarConfiguracion({ NODE_ENV: 'test', PERSISTENCIA: 'memoria', AUTH_MODE: 'dev' }))],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const como = (u: string) => {
    const r = () => request(app.getHttpServer());
    return {
      get: (url: string) => r().get(`/api/v1${url}`).set('x-usuario-id', u),
      post: (url: string) => r().post(`/api/v1${url}`).set('x-usuario-id', u),
      put: (url: string) => r().put(`/api/v1${url}`).set('x-usuario-id', u),
    };
  };

  it('contabilidad administra las empresas del holding y su NIT', async () => {
    await como('u-viajero').get('/administracion/empresas').expect(403);
    const nueva = await como('u-contabilidad').post('/administracion/empresas').send({ nombre: 'Holding Energía S.A.S.', nit: '902.555.444-1' }).expect(201);
    expect(nueva.body).toMatchObject({ nombre: 'Holding Energía S.A.S.', nit: '902555444', activa: true });
    const repetida = await como('u-contabilidad').post('/administracion/empresas').send({ nombre: 'Otra', nit: '902555444' }).expect(409);
    expect(repetida.body.code).toBe('NIT_REPETIDO');
    // Con usuarios activos no se puede desactivar
    await como('u-contabilidad').put('/administracion/empresas/emp-principal').send({ nombre: 'Empresa Colombia S.A.S.', nit: '900123456', activa: false }).expect(422);

    // La legalización muestra la empresa del viajero (a cuyo NIT deben venir las facturas)
    const empresas = (await como('u-admin').get('/administracion/empresas').expect(200)).body;
    expect(empresas.map((e: { nit: string }) => e.nit)).toContain('902555444');
  });

  it('el administrador crea usuarios con cargo, empresa, jefes y roles, y les asigna contraseña', async () => {
    await como('u-contabilidad').get('/administracion/usuarios').expect(403);
    await como('u-admin').post('/administracion/cargos').send({ codigo: 'gerente_regional', nombre: 'Gerente regional' }).expect(201);

    const datos = {
      nombre: 'Pedro Pérez',
      email: 'Pedro@Empresa.co',
      cargoId: 'GERENTE_REGIONAL',
      empresaId: 'emp-filial',
      jefeInmediatoId: 'u-directivo',
      jefeDirectivoId: '',
      roles: ['VIAJERO', 'APROBADOR'],
    };
    const creado = await como('u-admin').post('/administracion/usuarios').send(datos).expect(201);
    expect(creado.body).toMatchObject({ email: 'pedro@empresa.co', empresaId: 'emp-filial', jefeDirectivoId: null, activo: true });
    const id = creado.body.id as string;

    expect((await como('u-admin').post('/administracion/usuarios').send({ ...datos, nombre: 'Otro' }).expect(409)).body.code).toBe('EMAIL_REPETIDO');
    expect((await como('u-admin').put(`/administracion/usuarios/${id}`).send({ ...datos, jefeInmediatoId: id }).expect(422)).body.code).toBe('AUTOJEFE');
    expect((await como('u-admin').put('/administracion/usuarios/u-admin').send({ ...datos, email: 'andres@empresa.co', roles: ['VIAJERO'] }).expect(422)).body.code).toBe('AUTOBLOQUEO');

    await como('u-admin').put(`/administracion/usuarios/${id}/contrasena`).send({ contrasena: 'corta' }).expect(400);
    await como('u-admin').put(`/administracion/usuarios/${id}/contrasena`).send({ contrasena: 'NuevaClave2026' }).expect(204);
    await como('u-admin').put('/administracion/usuarios/no-existe/contrasena').send({ contrasena: 'NuevaClave2026' }).expect(404);
  });

  it('contabilidad crea conceptos y tarifas; una tarifa nueva reemplaza la anterior desde su fecha', async () => {
    await como('u-admin').get('/administracion/tarifas').expect(403);
    await como('u-contabilidad').post('/administracion/conceptos').send({ codigo: 'LAVANDERIA', nombre: 'Lavandería', unidad: 'DIA' }).expect(201);
    expect((await como('u-contabilidad').get('/administracion/conceptos').expect(200)).body.map((c: { codigo: string }) => c.codigo)).toContain('LAVANDERIA');

    const tarifa = await como('u-contabilidad')
      .post('/administracion/tarifas')
      .send({ cargoId: 'ANALISTA', paisCodigo: 'BR', conceptoCodigo: 'ALOJAMIENTO', valor: '45', moneda: 'USD', vigenteDesde: '2026-10-01' })
      .expect(201);
    expect(tarifa.body).toMatchObject({ valor: { monto: '45.00', moneda: 'USD' }, vigenteHasta: null });

    const brasil = (await como('u-contabilidad').get('/administracion/tarifas?cargoId=ANALISTA&paisCodigo=BR').expect(200)).body;
    expect(brasil.filter((t: { conceptoCodigo: string }) => t.conceptoCodigo === 'ALOJAMIENTO')).toEqual([
      expect.objectContaining({ vigenteDesde: '2026-01-01', vigenteHasta: '2026-09-30' }),
      expect.objectContaining({ vigenteDesde: '2026-10-01', vigenteHasta: null }),
    ]);

    // El estimado usa la tarifa vigente (45 USD): un hotel de 45 ya no supera la tarifa.
    const estimado = await como('u-viajero')
      .post('/solicitudes/estimar')
      .send({ destinos: [{ paisCodigo: 'BR', ciudad: 'Rio', fechaInicio: '2026-11-02', fechaFin: '2026-11-04', valoresSolicitados: [{ conceptoCodigo: 'ALOJAMIENTO', valorUnitario: '45' }] }] })
      .expect(200);
    expect(estimado.body.escalamiento.requiereJefeDirectivo).toBe(false);
  });
});
