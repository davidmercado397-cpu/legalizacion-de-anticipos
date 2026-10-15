import { http as rest, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, crearApi, type PuertoSesion } from '../src';

const BASE = 'http://api.test/api/v1';
const servidor = setupServer();
beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }));
afterEach(() => servidor.resetHandlers());
afterAll(() => servidor.close());

const problema = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  HttpResponse.json({ type: `urn:${code}`, title: code, status, code, ...extra }, {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

function sesionFalsa(tokenInicial: string | null, tokenRenovado: string | null) {
  let token = tokenInicial;
  const sesion: PuertoSesion & { renovaciones: number } = {
    renovaciones: 0,
    accessToken: () => token,
    renovar: vi.fn(async () => {
      sesion.renovaciones++;
      await new Promise((r) => setTimeout(r, 20));
      token = tokenRenovado;
      return tokenRenovado;
    }),
    expirada: vi.fn(),
  };
  return sesion;
}

describe('cliente HTTP', () => {
  it('envía el Bearer token y el idioma', async () => {
    let cabeceras: Headers | undefined;
    servidor.use(
      rest.get(`${BASE}/auth/me`, ({ request }) => {
        cabeceras = request.headers;
        return HttpResponse.json({ id: 'u', nombre: 'Ana', email: 'a@e.co', roles: ['VIAJERO'] });
      }),
    );
    await crearApi({ baseURL: BASE, sesion: sesionFalsa('t1', null), idioma: () => 'es' }).auth.perfil();
    expect(cabeceras?.get('authorization')).toBe('Bearer t1');
    expect(cabeceras?.get('accept-language')).toBe('es');
  });

  it('renueva una sola vez aunque fallen varias peticiones a la vez, y las reintenta', async () => {
    servidor.use(
      rest.get(`${BASE}/solicitudes`, ({ request }) =>
        request.headers.get('authorization') === 'Bearer nuevo' ? HttpResponse.json([]) : problema(401, 'TOKEN_VENCIDO'),
      ),
    );
    const sesion = sesionFalsa('viejo', 'nuevo');
    const api = crearApi({ baseURL: BASE, sesion });
    const resultados = await Promise.all([api.solicitudes.misSolicitudes(), api.solicitudes.misSolicitudes(), api.solicitudes.misSolicitudes()]);
    expect(resultados).toEqual([[], [], []]);
    expect(sesion.renovaciones).toBe(1);
  });

  it('si no puede renovar, avisa que la sesión expiró', async () => {
    servidor.use(rest.get(`${BASE}/solicitudes`, () => problema(401, 'TOKEN_VENCIDO')));
    const sesion = sesionFalsa('viejo', null);
    await expect(crearApi({ baseURL: BASE, sesion }).solicitudes.misSolicitudes()).rejects.toMatchObject({
      status: 401,
    });
    expect(sesion.expirada).toHaveBeenCalledOnce();
  });

  it('normaliza problem+json a ApiError con errores por campo', async () => {
    servidor.use(
      rest.post(`${BASE}/solicitudes/estimar`, () =>
        problema(400, 'ENTRADA_INVALIDA', { errors: { 'destinos.0.fechaFin': ['validation.endBeforeStart'] } }),
      ),
    );
    const error = await crearApi({ baseURL: BASE, sesion: sesionFalsa('t', null) })
      .solicitudes.estimar({ monedaAnticipo: 'USD', destinos: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ codigo: 'ENTRADA_INVALIDA', erroresCampo: { 'destinos.0.fechaFin': ['validation.endBeforeStart'] } });
  });

  it('distingue la falta de conexión', async () => {
    servidor.use(rest.get(`${BASE}/solicitudes`, () => HttpResponse.error()));
    await expect(crearApi({ baseURL: BASE, sesion: sesionFalsa('t', null) }).solicitudes.misSolicitudes()).rejects.toMatchObject({
      codigo: 'SIN_CONEXION',
    });
  });

  it('distingue cuando el proxy no alcanza la API (502)', async () => {
    servidor.use(rest.get(`${BASE}/solicitudes`, () => new HttpResponse('Bad Gateway', { status: 502 })));
    await expect(crearApi({ baseURL: BASE, sesion: sesionFalsa('t', null) }).solicitudes.misSolicitudes()).rejects.toMatchObject({
      codigo: 'SERVIDOR_NO_DISPONIBLE',
    });
  });

  it('rechaza respuestas que no cumplen el contrato', async () => {
    servidor.use(rest.get(`${BASE}/solicitudes/destinos-disponibles`, () => HttpResponse.json({ paises: [123] })));
    await expect(crearApi({ baseURL: BASE, sesion: sesionFalsa('t', null) }).solicitudes.destinosDisponibles()).rejects.toThrow();
  });
});
