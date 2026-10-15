import { DomainError, FechaCalendario, Money, type MoneyDto } from '@viaticos/shared-kernel';
import type { GeneradorIds, PublicadorEventos, Reloj } from '../../../shared/application/puertos';
import { Anticipo, type AnticipoRepository, type EstadoAnticipo, type MedioDesembolso, type ViajeAnticipo } from '../domain/anticipo';
import type { ErpAnticiposGateway } from './puertos';

export class GestionAnticipos {
  constructor(
    private readonly anticipos: AnticipoRepository,
    private readonly erp: ErpAnticiposGateway,
    private readonly ids: GeneradorIds,
    private readonly reloj: Reloj,
    private readonly eventos: PublicadorEventos,
  ) {}

  /**
   * Reacción a SolicitudAprobada. Idempotente: si el anticipo de la solicitud ya
   * existe no se crea otro (permite reprocesar el evento sin duplicar dinero).
   */
  async crearDesdeSolicitudAprobada(datos: {
    solicitudId: string;
    viajeroId: string;
    monto: MoneyDto;
    viaje: ViajeAnticipo;
  }): Promise<Anticipo> {
    const existente = await this.anticipos.obtenerPorSolicitud(datos.solicitudId);
    if (existente) return existente;

    const anticipo = Anticipo.crearDesdeSolicitud({
      id: this.ids.nuevo(),
      solicitudId: datos.solicitudId,
      viajeroId: datos.viajeroId,
      monto: Money.fromDto(datos.monto),
      viaje: datos.viaje,
      ahora: this.reloj.ahora(),
    });
    await this.anticipos.guardar(anticipo);
    return this.registrarEnErp(anticipo.id);
  }

  /** Registra en el ERP; si falla, deja el error para reintentar (no se pierde el anticipo). */
  async registrarEnErp(anticipoId: string): Promise<Anticipo> {
    const anticipo = await this.exigir(anticipoId);
    try {
      const { referencia } = await this.erp.registrarAnticipo({
        anticipoId: anticipo.id,
        solicitudId: anticipo.solicitudId,
        viajeroId: anticipo.viajeroId,
        monto: anticipo.monto,
        concepto: `Anticipo de viaje: ${anticipo.viaje.motivo}`.slice(0, 200),
      });
      anticipo.registradoEnErp(referencia, this.reloj.ahora());
    } catch (error) {
      if (error instanceof DomainError && error.tipo === 'CONFLICTO') throw error;
      anticipo.falloRegistroErp(error instanceof Error ? error.message : String(error), this.reloj.ahora());
    }
    await this.anticipos.guardar(anticipo);
    return anticipo;
  }

  async registrarDesembolso(datos: {
    anticipoId: string;
    tesoreroId: string;
    fecha: string;
    medio: MedioDesembolso;
    referencia?: string | undefined;
  }): Promise<Anticipo> {
    const anticipo = await this.exigir(datos.anticipoId);
    anticipo.registrarDesembolso({
      fecha: FechaCalendario.of(datos.fecha),
      medio: datos.medio,
      referencia: datos.referencia ?? null,
      tesoreroId: datos.tesoreroId,
      ahora: this.reloj.ahora(),
    });
    await this.anticipos.guardar(anticipo);
    await this.eventos.publicar(anticipo.extraerEventos());
    return anticipo;
  }

  /** Lo invoca la legalización aprobada. */
  async marcarLegalizado(anticipoId: string): Promise<void> {
    const anticipo = await this.exigir(anticipoId);
    anticipo.marcarLegalizado(this.reloj.ahora());
    await this.anticipos.guardar(anticipo);
  }

  /** Vista para el viajero dueño, tesorería o contabilidad. */
  async obtenerPara(anticipoId: string, usuarioId: string, roles: readonly string[]): Promise<Anticipo> {
    const anticipo = await this.anticipos.obtenerPorId(anticipoId);
    const autorizado = anticipo && (anticipo.viajeroId === usuarioId || roles.some((r) => r === 'TESORERIA' || r === 'CONTABILIDAD'));
    if (!anticipo || !autorizado) throw new DomainError('ANTICIPO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El anticipo no existe');
    return anticipo;
  }

  obtener(anticipoId: string): Promise<Anticipo> {
    return this.exigir(anticipoId);
  }

  listarDelViajero(viajeroId: string): Promise<Anticipo[]> {
    return this.anticipos.listarPorViajero(viajeroId);
  }

  listarPorEstados(estados: readonly EstadoAnticipo[]): Promise<Anticipo[]> {
    return this.anticipos.listarPorEstados(estados);
  }

  private async exigir(id: string): Promise<Anticipo> {
    const anticipo = await this.anticipos.obtenerPorId(id);
    if (!anticipo) throw new DomainError('ANTICIPO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El anticipo no existe');
    return anticipo;
  }
}
