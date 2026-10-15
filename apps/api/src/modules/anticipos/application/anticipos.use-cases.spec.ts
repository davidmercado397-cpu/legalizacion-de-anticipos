import { describe, expect, it } from 'vitest';
import { FechaCalendario } from '@viaticos/shared-kernel';
import type { EventoDominio } from '../../../shared/domain/agregado-raiz';
import { AnticipoRepositoryEnMemoria } from '../infrastructure/anticipo.repository.memoria';
import { ErpAnticiposSimulado } from '../infrastructure/erp-anticipos.simulado';
import { GestionAnticipos } from './anticipos.use-cases';

const reloj = { ahora: () => new Date('2026-10-20T15:00:00Z'), hoy: () => FechaCalendario.of('2026-10-20') };
let n = 0;
const ids = { nuevo: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };

function montar(fallasErp = 0) {
  const repo = new AnticipoRepositoryEnMemoria();
  const publicados: EventoDominio[] = [];
  const gestion = new GestionAnticipos(repo, new ErpAnticiposSimulado(fallasErp), ids, reloj, {
    publicar: async (e) => void publicados.push(...e),
  });
  return { gestion, repo, publicados };
}

const aprobada = {
  solicitudId: 'sol-1',
  viajeroId: 'ana',
  monto: { monto: '475.00', moneda: 'USD' },
  viaje: { motivo: 'Cliente', destinos: [{ paisCodigo: 'BR', ciudad: 'Rio', fechaInicio: '2026-11-02', fechaFin: '2026-11-06' }] },
};

describe('GestionAnticipos', () => {
  it('crea el anticipo y lo registra en el ERP', async () => {
    const { gestion } = montar();
    const a = await gestion.crearDesdeSolicitudAprobada(aprobada);
    expect(a.estado).toBe('POR_DESEMBOLSAR');
    expect(a.erp.referencia).toMatch(/^SIM-ANT-/);
  });

  it('es idempotente: reprocesar el evento no crea un segundo anticipo', async () => {
    const { gestion, repo } = montar();
    const a = await gestion.crearDesdeSolicitudAprobada(aprobada);
    const b = await gestion.crearDesdeSolicitudAprobada(aprobada);
    expect(b.id).toBe(a.id);
    expect(await repo.listarPorViajero('ana')).toHaveLength(1);
  });

  it('si el ERP falla queda pendiente y tesorería puede reintentar', async () => {
    const { gestion } = montar(1);
    const a = await gestion.crearDesdeSolicitudAprobada(aprobada);
    expect(a.estado).toBe('PENDIENTE_ERP');
    expect(a.erp.ultimoError).toMatch(/no disponible/);
    const reintento = await gestion.registrarEnErp(a.id);
    expect(reintento.estado).toBe('POR_DESEMBOLSAR');
  });

  it('el desembolso de tesorería publica AnticipoDesembolsado', async () => {
    const { gestion, publicados } = montar();
    const a = await gestion.crearDesdeSolicitudAprobada(aprobada);
    await gestion.registrarDesembolso({ anticipoId: a.id, tesoreroId: 'tomas', fecha: '2026-10-20', medio: 'TRANSFERENCIA' });
    expect(publicados.map((e) => e.tipo)).toEqual(['anticipos.AnticipoDesembolsado']);
  });

  it('solo el viajero dueño, tesorería o contabilidad ven el anticipo', async () => {
    const { gestion } = montar();
    const a = await gestion.crearDesdeSolicitudAprobada(aprobada);
    await expect(gestion.obtenerPara(a.id, 'ana', [])).resolves.toBeDefined();
    await expect(gestion.obtenerPara(a.id, 'tomas', ['TESORERIA'])).resolves.toBeDefined();
    await expect(gestion.obtenerPara(a.id, 'carlos', ['APROBADOR'])).rejects.toMatchObject({ codigo: 'ANTICIPO_NO_ENCONTRADO' });
  });
});
