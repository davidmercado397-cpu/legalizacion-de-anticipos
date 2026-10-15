import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { cargarConfiguracion } from '../src/shared/configuracion';
import { FechaCalendario } from '@viaticos/shared-kernel';
import { COLA_TRABAJOS, RELOJ } from '../src/shared/tokens';
import type { ColaTrabajosEnProceso } from '../src/shared/infrastructure/cola-trabajos-en-proceso';

const JPEG = (n: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe('Legalización (e2e HTTP)', () => {
  let app: INestApplication;
  let almacen: string;
  let cola: ColaTrabajosEnProceso;

  beforeAll(async () => {
    almacen = mkdtempSync(join(tmpdir(), 'viaticos-almacen-'));
    const modulo = await Test.createTestingModule({
      imports: [AppModule.forRoot(cargarConfiguracion({ NODE_ENV: 'test', PERSISTENCIA: 'memoria', AUTH_MODE: 'dev', ALMACEN_DIR: almacen }))],
    })
      // Reloj fijo: las facturas del viaje (noviembre) no deben verse como "futuras".
      .overrideProvider(RELOJ)
      .useValue({ ahora: () => new Date('2026-11-10T15:00:00Z'), hoy: () => FechaCalendario.of('2026-11-10') })
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
    cola = app.get(COLA_TRABAJOS);
  });

  afterAll(async () => {
    await app?.close();
    rmSync(almacen, { recursive: true, force: true });
  });

  const como = (u: string) => {
    const r = () => request(app.getHttpServer());
    return {
      get: (url: string) => r().get(`/api/v1${url}`).set('x-usuario-id', u),
      post: (url: string) => r().post(`/api/v1${url}`).set('x-usuario-id', u),
      put: (url: string) => r().put(`/api/v1${url}`).set('x-usuario-id', u),
      del: (url: string) => r().delete(`/api/v1${url}`).set('x-usuario-id', u),
    };
  };

  it('ciclo completo: anticipo desembolsado → soportes → revisión contable → anticipo legalizado', async () => {
    // 1. Solicitud aprobada (sin escalamiento) y anticipo desembolsado
    const sol = await como('u-viajero')
      .post('/solicitudes')
      .send({
        monedaAnticipo: 'USD',
        motivo: 'Visita técnica São Paulo',
        destinos: [{ paisCodigo: 'BR', ciudad: 'São Paulo', fechaInicio: '2026-11-02', fechaFin: '2026-11-06' }],
      })
      .expect(201);
    await como('u-jefe').post(`/solicitudes/${sol.body.id}/aprobar`).send({}).expect(200);
    const [anticipo] = (await como('u-viajero').get('/anticipos/mios').expect(200)).body;
    await como('u-tesoreria').post(`/anticipos/${anticipo.id}/desembolso`).send({ fecha: '2026-10-28', medio: 'TRANSFERENCIA' }).expect(200);

    // 2. La legalización se abrió sola
    const leg = (await como('u-viajero').get(`/legalizaciones/por-anticipo/${anticipo.id}`).expect(200)).body;
    expect(leg).toMatchObject({ estado: 'ABIERTA', editable: true, montoAnticipo: { monto: '395.00', moneda: 'USD' } }); // 4×30 + 5×35 + 5×20
    await como('u-jefe').get(`/legalizaciones/${leg.id}`).expect(404);

    // 3. Foto de la factura (multipart); sin OCR configurado queda para digitación
    await como('u-viajero').post(`/legalizaciones/${leg.id}/soportes`).field('descripcion', 'Cena').attach('archivo', JPEG(1), 'f.jpg').expect(400);
    await como('u-viajero')
      .post(`/legalizaciones/${leg.id}/soportes`)
      .field('descripcion', 'Cena con el cliente')
      .attach('archivo', Buffer.from('<svg/>'), 'malicioso.jpg')
      .expect(422);
    const conFoto = await como('u-viajero')
      .post(`/legalizaciones/${leg.id}/soportes`)
      .field('descripcion', 'Cena con el cliente')
      .attach('archivo', JPEG(1), 'factura.jpg')
      .expect(201);
    const soporteId = conFoto.body.soportes[0].id as string;
    await cola.esperarInactividad();

    // El mismo archivo no entra dos veces
    const dup = await como('u-viajero').post(`/legalizaciones/${leg.id}/soportes`).field('descripcion', 'Cena repetida').attach('archivo', JPEG(1), 'otra.jpg').expect(409);
    expect(dup.body.code).toBe('COMPROBANTE_DUPLICADO');

    const archivo = await como('u-viajero').get(`/legalizaciones/${leg.id}/soportes/${soporteId}/archivo`).expect(200);
    expect(archivo.headers['content-type']).toBe('image/jpeg');
    expect(archivo.headers['x-content-type-options']).toBe('nosniff');

    // 4. Confirmación: a nombre de un tercero (alerta) y con caipirinha (línea excluida)
    const confirmada = await como('u-viajero')
      .put(`/legalizaciones/${leg.id}/soportes/${soporteId}/confirmacion`)
      .send({
        emisorNombre: 'Churrascaria Boi',
        emisorId: '12.345.678/0001-90',
        adquirienteId: '79123456',
        numeroDocumento: '445',
        fecha: '2026-11-03',
        moneda: 'BRL',
        total: '300.00',
        medioPago: 'TARJETA',
        ultimos4Tarjeta: '4321',
        paisCodigo: 'BR',
        categoria: 'ALIMENTACION',
        lineas: [
          { descripcion: 'Rodízio', valor: '270.00' },
          { descripcion: 'Caipirinha', valor: '30.00' },
        ],
      })
      .expect(200);
    const s = confirmada.body.soportes[0];
    expect(s.alertas.map((a: { codigo: string }) => a.codigo)).toEqual(['NO_A_NOMBRE_EMPRESA', 'SIN_CLAVE_FISCAL', 'LINEAS_EXCLUIDAS']);
    expect(s.montos).toEqual({ aceptado: { monto: '50.00', moneda: 'USD' }, excluido: { monto: '5.56', moneda: 'USD' } }); // 270 BRL / 5.40

    // 5. Recibo de caja 222 (sin factura)
    await como('u-viajero')
      .post(`/legalizaciones/${leg.id}/recibos-caja`)
      .field({ descripcion: 'Taxi informal al hotel', fecha: '2026-11-02', moneda: 'USD', valor: '60', categoria: 'TRANSPORTE', paisCodigo: 'BR' })
      .expect(422);
    const conRecibo = await como('u-viajero')
      .post(`/legalizaciones/${leg.id}/recibos-caja`)
      .field({ descripcion: 'Taxi informal al hotel', fecha: '2026-11-02', moneda: 'USD', valor: '20', categoria: 'TRANSPORTE', paisCodigo: 'BR' })
      .expect(201);
    expect(conRecibo.body.resumen).toEqual({
      totalAceptado: { monto: '70.00', moneda: 'USD' },
      totalExcluido: { monto: '5.56', moneda: 'USD' },
      saldo: { monto: '325.00', moneda: 'USD' },
    });

    // 6. Envío y revisión contable
    await como('u-viajero').post(`/legalizaciones/${leg.id}/enviar`).expect(200);
    await como('u-viajero').get('/legalizaciones').expect(403);
    const bandeja = await como('u-contabilidad').get('/legalizaciones').expect(200);
    expect(bandeja.body.map((x: { id: string }) => x.id)).toContain(leg.id);
    await como('u-contabilidad').post(`/legalizaciones/${leg.id}/aprobar`).expect(422);
    await como('u-contabilidad')
      .post(`/legalizaciones/${leg.id}/soportes/${soporteId}/decision`)
      .send({ aplica: true, comentario: 'Cliente pagó a nombre del gerente; se acepta' })
      .expect(200);
    const aprobada = await como('u-contabilidad').post(`/legalizaciones/${leg.id}/aprobar`).expect(200);
    expect(aprobada.body.estado).toBe('APROBADA');
    expect(aprobada.body.historial.map((h: { tipo: string; usuarioNombre: string }) => `${h.tipo}:${h.usuarioNombre}`)).toEqual([
      'ENVIADA:Ana Viajera',
      'APROBADA:Laura Contable',
    ]);

    // 7. El anticipo quedó legalizado
    const final = await como('u-viajero').get(`/anticipos/${anticipo.id}`).expect(200);
    expect(final.body.estado).toBe('LEGALIZADO');
  });

  it('contabilidad administra la política; el resto solo la consulta', async () => {
    const politica = (await como('u-viajero').get('/politica-legalizacion').expect(200)).body;
    expect(politica.topesReciboCaja).toContainEqual({ monto: '50.00', moneda: 'USD' });
    await como('u-viajero').put('/politica-legalizacion').send(politica).expect(403);
    const nueva = await como('u-contabilidad')
      .put('/politica-legalizacion')
      .send({ ...politica, topesReciboCaja: [{ monto: '70', moneda: 'USD' }, { monto: '250000', moneda: 'COP' }] })
      .expect(200);
    expect(nueva.body).toMatchObject({ actualizadaPor: 'u-contabilidad', topesReciboCaja: [{ monto: '70.00', moneda: 'USD' }, { monto: '250000.00', moneda: 'COP' }] });
  });
});
