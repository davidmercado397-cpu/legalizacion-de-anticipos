import { http as rest, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, crearApi, type PuertoSesion } from '../src';

const BASE = 'http://api.test/api/v1';
const servidor = setupServer();
beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }));
afterEach(() => servidor.resetHandlers());
afterAll(() => servidor.close());

const problema = (status: number, code: string, details: Record<string, unknown>[] = []) =>
  HttpResponse.json({ error: { code, message: `Mensaje de ${code}`, details, request_id: 'req-1' } }, { status });

const PAGINA_VACIA = { data: [], pagination: { limit: 50, offset: 0, total: 0 } };

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
      rest.get(`${BASE}/me`, ({ request }) => {
        cabeceras = request.headers;
        return HttpResponse.json({ id: 'u', full_name: 'Ana', email: 'a@e.co', role: 'employee' });
      }),
    );
    await crearApi({ baseURL: BASE, sesion: sesionFalsa('t1', null), idioma: () => 'es' }).auth.perfil();
    expect(cabeceras?.get('authorization')).toBe('Bearer t1');
    expect(cabeceras?.get('accept-language')).toBe('es');
  });

  it('renueva una sola vez aunque fallen varias peticiones a la vez, y las reintenta', async () => {
    servidor.use(
      rest.get(`${BASE}/advances`, ({ request }) =>
        request.headers.get('authorization') === 'Bearer nuevo' ? HttpResponse.json(PAGINA_VACIA) : problema(401, 'session_expired'),
      ),
    );
    const sesion = sesionFalsa('viejo', 'nuevo');
    const api = crearApi({ baseURL: BASE, sesion });
    const resultados = await Promise.all([api.anticipos.listar(), api.anticipos.listar(), api.anticipos.listar()]);
    expect(resultados).toEqual([PAGINA_VACIA, PAGINA_VACIA, PAGINA_VACIA]);
    expect(sesion.renovaciones).toBe(1);
  });

  it('si no puede renovar, avisa que la sesión expiró', async () => {
    servidor.use(rest.get(`${BASE}/advances`, () => problema(401, 'session_expired')));
    const sesion = sesionFalsa('viejo', null);
    await expect(crearApi({ baseURL: BASE, sesion }).anticipos.listar()).rejects.toMatchObject({
      status: 401,
    });
    expect(sesion.expirada).toHaveBeenCalledOnce();
  });

  it('normaliza el error de la API con sus errores por campo', async () => {
    servidor.use(
      rest.post(`${BASE}/advances`, () => problema(422, 'validation_error', [{ field: 'end_date', issue: 'Fecha inválida.' }])),
    );
    const error = await crearApi({ baseURL: BASE, sesion: sesionFalsa('t', null) })
      .anticipos.solicitar({ company_id: 'c', kind: 'cash', currency: 'COP', purpose: 'Visita' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      codigo: 'validation_error',
      message: 'Mensaje de validation_error',
      requestId: 'req-1',
      erroresCampo: { end_date: ['Fecha inválida.'] },
    });
  });

  it('no intenta renovar cuando falla el propio login', async () => {
    servidor.use(rest.post(`${BASE}/auth/login`, () => problema(401, 'invalid_credentials')));
    const sesion = sesionFalsa('t', 'nuevo');
    await expect(crearApi({ baseURL: BASE, sesion }).auth.login({ email: 'a@e.co', password: 'x' })).rejects.toMatchObject({
      codigo: 'invalid_credentials',
    });
    expect(sesion.renovaciones).toBe(0);
  });

  it('distingue la falta de conexión', async () => {
    servidor.use(rest.get(`${BASE}/advances`, () => HttpResponse.error()));
    await expect(crearApi({ baseURL: BASE, sesion: sesionFalsa('t', null) }).anticipos.listar()).rejects.toMatchObject({
      codigo: 'sin_conexion',
    });
  });

  it('distingue cuando el proxy no alcanza la API (502)', async () => {
    servidor.use(rest.get(`${BASE}/advances`, () => new HttpResponse('Bad Gateway', { status: 502 })));
    await expect(crearApi({ baseURL: BASE, sesion: sesionFalsa('t', null) }).anticipos.listar()).rejects.toMatchObject({
      codigo: 'servidor_no_disponible',
    });
  });
});
