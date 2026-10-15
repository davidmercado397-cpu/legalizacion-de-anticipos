import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { CONTRASENA_DESARROLLO } from '../../src/database/sembrar';
import { cargarConfiguracion } from '../../src/shared/configuracion';
import type { ConexionBaseDatos } from '../../src/shared/infrastructure/base-datos/conexion';
import { URL_PRUEBAS, prepararBaseDePruebas } from './base-de-pruebas';

describe.runIf(URL_PRUEBAS)('API con JWT y PostgreSQL (integración)', () => {
  let app: INestApplication;
  let conexion: ConexionBaseDatos;

  beforeAll(async () => {
    conexion = await prepararBaseDePruebas();
    const modulo = await Test.createTestingModule({
      imports: [
        AppModule.forRoot(
          cargarConfiguracion({
            NODE_ENV: 'test',
            PERSISTENCIA: 'postgres',
            DATABASE_URL: URL_PRUEBAS,
            AUTH_MODE: 'jwt',
            JWT_SECRET: 'secreto-de-pruebas-de-integracion-0123456789',
          }),
        ),
      ],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await conexion?.onApplicationShutdown();
  });

  const http = () => request(app.getHttpServer());
  const login = (email: string, contrasena = CONTRASENA_DESARROLLO) =>
    http().post('/api/v1/auth/login').send({ email, contrasena });
  const cookieRefresh = (r: request.Response) =>
    ([] as string[]).concat(r.headers['set-cookie'] ?? []).find((c) => c.startsWith('viaticos_rt='))!.split(';')[0]!;

  it('rechaza credenciales inválidas con 401 sin revelar si el correo existe', async () => {
    const a = await login('ana@empresa.co', 'equivocada');
    const b = await login('nadie@empresa.co', 'equivocada');
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.code).toBe('CREDENCIALES_INVALIDAS');
    expect(b.body.code).toBe('CREDENCIALES_INVALIDAS');
  });

  it('login web: access token en el cuerpo y refresh token solo en cookie httpOnly', async () => {
    const r = await login('ANA@empresa.co').expect(200);
    expect(r.body.usuario).toMatchObject({ id: 'u-viajero', roles: ['VIAJERO'] });
    expect(r.body.refreshToken).toBeUndefined();
    const cookie = ([] as string[]).concat(r.headers['set-cookie'] ?? []).find((c) => c.startsWith('viaticos_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    const me = await http().get('/api/v1/auth/me').set('authorization', `Bearer ${r.body.accessToken}`).expect(200);
    expect(me.body.email).toBe('ana@empresa.co');
  });

  it('sin token o con token adulterado responde 401', async () => {
    await http().get('/api/v1/auth/me').expect(401);
    const r = await login('ana@empresa.co');
    const adulterado = `${r.body.accessToken.slice(0, -2)}xx`;
    const res = await http().get('/api/v1/auth/me').set('authorization', `Bearer ${adulterado}`).expect(401);
    expect(res.body.code).toBe('TOKEN_INVALIDO');
  });

  it('refresh rota el token; reutilizar uno viejo revoca toda la familia', async () => {
    const inicio = await login('carlos@empresa.co');
    const cookie1 = cookieRefresh(inicio);

    const r2 = await http().post('/api/v1/auth/refresh').set('cookie', cookie1).send({}).expect(200);
    const cookie2 = cookieRefresh(r2);
    expect(cookie2).not.toBe(cookie1);

    const reuso = await http().post('/api/v1/auth/refresh').set('cookie', cookie1).send({}).expect(401);
    expect(reuso.body.code).toBe('SESION_REUTILIZADA');
    // El token legítimo más reciente también quedó revocado.
    await http().post('/api/v1/auth/refresh').set('cookie', cookie2).send({}).expect(401);
  });

  it('cliente móvil recibe el refresh token en el cuerpo', async () => {
    const r = await http()
      .post('/api/v1/auth/login')
      .set('x-cliente', 'movil')
      .send({ email: 'diana@empresa.co', contrasena: CONTRASENA_DESARROLLO })
      .expect(200);
    expect(r.body.refreshToken).toEqual(expect.any(String));
    await http().post('/api/v1/auth/refresh').set('x-cliente', 'movil').send({ refreshToken: r.body.refreshToken }).expect(200);
  });

  it('flujo completo persistido: destinos → crear → aprobar en dos niveles', async () => {
    const token = async (email: string) => `Bearer ${(await login(email)).body.accessToken}`;
    const ana = await token('ana@empresa.co');

    const destinos = await http().get('/api/v1/solicitudes/destinos-disponibles').set('authorization', ana).expect(200);
    expect(destinos.body.paises).toEqual(['BR', 'CO', 'US']);

    const creada = await http()
      .post('/api/v1/solicitudes')
      .set('authorization', ana)
      .send({
        monedaAnticipo: 'COP',
        motivo: 'Implementación en cliente São Paulo',
        justificacion: 'Hotel junto al cliente',
        destinos: [
          {
            paisCodigo: 'BR',
            ciudad: 'São Paulo',
            fechaInicio: '2026-11-02',
            fechaFin: '2026-11-06',
            valoresSolicitados: [{ conceptoCodigo: 'ALOJAMIENTO', valorUnitario: '50' }],
          },
        ],
      })
      .expect(201);
    const id = creada.body.id as string;
    expect(creada.body.presupuesto.totalAnticipo).toEqual({ monto: '1900000.00', moneda: 'COP' });

    const [carlos, diana] = [await token('carlos@empresa.co'), await token('diana@empresa.co')];
    await http().post(`/api/v1/solicitudes/${id}/aprobar`).set('authorization', carlos).send({}).expect(200);
    const final = await http()
      .post(`/api/v1/solicitudes/${id}/aprobar`)
      .set('authorization', diana)
      .send({ comentario: 'Aprobado' })
      .expect(200);
    expect(final.body.estado).toBe('APROBADA');

    const mias = await http().get('/api/v1/solicitudes').set('authorization', ana).expect(200);
    expect(mias.body.map((s: { id: string }) => s.id)).toContain(id);
  });
});
