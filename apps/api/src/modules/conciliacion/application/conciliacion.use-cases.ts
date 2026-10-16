import { createHash } from 'node:crypto';
import { DomainError, FechaCalendario, Money } from '@viaticos/shared-kernel';
import type { GeneradorIds, ProveedorTasaCambio, PublicadorEventos, Reloj } from '../../../shared/application/puertos';
import { conciliar, PARAMETROS_POR_DEFECTO, type PagoTarjeta } from '../domain/conciliador';
import { Extracto, type ExtractoRepository, type PerfilExtractoRepository } from '../domain/extracto';
import { leerMovimientos, type PerfilExtracto } from '../domain/perfil-extracto';
import { sugerirPerfil } from '../domain/sugerir-perfil';
import type { CargoSinSoporteDecidido, EstadoBancarioActualizado } from './eventos-publicos';
import type { ConsultaLegalizaciones, LectorTabular } from './puertos';

/** Quién ve un extracto: el titular de la tarjeta, tesorería y contabilidad. */
const VEN_TODO = ['CONTABILIDAD', 'TESORERIA'];
const veTodo = (roles: readonly string[]) => roles.some((r) => VEN_TODO.includes(r));

export const TAMANO_MAXIMO_EXTRACTO = 5 * 1024 * 1024;
const FILAS_VISTA_PREVIA = 15;

interface Archivo {
  nombre: string;
  contenido: Buffer;
}

export interface DetalleExtracto {
  extracto: Extracto;
  /** Pagos con tarjeta del titular en el periodo del extracto (con margen), ya convertidos. */
  pagos: PagoTarjeta[];
  /** De esos, los que están cruzados en otro extracto. */
  cruzadosEnOtro: Set<string>;
}

export class GestionConciliacion {
  constructor(
    private readonly extractos: ExtractoRepository,
    private readonly perfiles: PerfilExtractoRepository,
    private readonly lector: LectorTabular,
    private readonly legalizaciones: ConsultaLegalizaciones,
    private readonly tasas: ProveedorTasaCambio,
    private readonly ids: GeneradorIds,
    private readonly reloj: Reloj,
    private readonly eventos: PublicadorEventos,
  ) {}

  /** Muestra cómo se leería el archivo, con el perfil indicado o con uno sugerido. */
  async vistaPrevia(archivo: Archivo, perfil: PerfilExtracto | null, moneda: string) {
    const filas = await this.leerArchivo(archivo);
    const sugerencia = perfil ? { perfil, confianza: 'ALTA' as const } : sugerirPerfil(filas, moneda);
    const lectura = leerMovimientos(filas, sugerencia.perfil);
    return {
      filas: filas.slice(0, FILAS_VISTA_PREVIA),
      totalFilas: filas.length,
      perfil: sugerencia.perfil,
      confianza: sugerencia.confianza,
      movimientos: lectura.movimientos.slice(0, 20),
      totalCargos: lectura.movimientos.filter((m) => m.tipo === 'DEBITO').length,
      totalAbonos: lectura.movimientos.filter((m) => m.tipo === 'CREDITO').length,
      omitidas: lectura.omitidas.slice(0, 20),
      perfilesGuardados: await this.perfiles.listar(),
    };
  }

  async cargar(datos: {
    archivo: Archivo;
    legalizacionId: string;
    ultimos4: string | null;
    perfil: PerfilExtracto;
    guardarPerfilComo: string | null;
    usuarioId: string;
    roles: readonly string[];
  }): Promise<DetalleExtracto> {
    // Tesorería carga el extracto cuando el viajero ya envió la legalización, para validar los pagos con tarjeta.
    if (!datos.roles.includes('TESORERIA')) {
      throw new DomainError('NO_AUTORIZADO', 'NO_AUTORIZADO', 'Solo tesorería carga extractos bancarios');
    }
    const legalizacion = await this.legalizaciones.legalizacion(datos.legalizacionId);
    if (!legalizacion) throw new DomainError('LEGALIZACION_NO_ENCONTRADA', 'NO_ENCONTRADO', 'La legalización no existe');
    if (legalizacion.estado !== 'EN_REVISION' && legalizacion.estado !== 'DEVUELTA') {
      throw new DomainError('LEGALIZACION_NO_ENVIADA', 'REGLA_NEGOCIO', 'El extracto se carga cuando el viajero ya envió la legalización a revisión');
    }
    const sha256 = createHash('sha256').update(datos.archivo.contenido).digest('hex');
    if (await this.extractos.existeArchivo(sha256)) {
      throw new DomainError('EXTRACTO_YA_CARGADO', 'CONFLICTO', 'Este archivo de extracto ya fue cargado');
    }
    const filas = await this.leerArchivo(datos.archivo);
    const { movimientos } = leerMovimientos(filas, datos.perfil);
    const ahora = this.reloj.ahora();
    const extracto = Extracto.cargar({
      id: this.ids.nuevo(),
      titularId: legalizacion.viajeroId,
      legalizacionId: legalizacion.id,
      ultimos4: datos.ultimos4,
      moneda: datos.perfil.moneda,
      archivo: { nombre: datos.archivo.nombre, sha256 },
      perfil: datos.perfil,
      movimientos: movimientos.map((m) => ({ ...m, id: this.ids.nuevo() })),
      cargadoPor: datos.usuarioId,
      cargadoEn: ahora,
    });
    const detalle = await this.cruzar(extracto);
    await this.extractos.guardar(extracto);
    await this.publicarEstados(detalle);
    if (datos.guardarPerfilComo?.trim()) {
      await this.perfiles.guardar({
        id: this.ids.nuevo(),
        nombre: datos.guardarPerfilComo.trim(),
        perfil: datos.perfil,
        actualizadoPor: datos.usuarioId,
        actualizadoEn: ahora,
      });
    }
    return detalle;
  }

  /** Vuelve a cruzar (por ejemplo, después de que el viajero agregó facturas). */
  async recalcular(extractoId: string): Promise<DetalleExtracto> {
    const extracto = await this.exigir(extractoId);
    const antes = [...extracto.decisionesCargos];
    const detalle = await this.cruzar(extracto);
    await this.extractos.guardar(extracto);
    await this.publicarCambios(detalle, antes);
    return detalle;
  }

  /** Contabilidad decide si un cargo sin factura se descuenta al viajero (suma a lo que debe devolver). */
  async decidirCargo(extractoId: string, movimientoId: string, descontar: boolean, usuarioId: string): Promise<DetalleExtracto> {
    const extracto = await this.exigir(extractoId);
    const cargo = extracto.decidirCargo(movimientoId, descontar, usuarioId, this.reloj.ahora());
    await this.extractos.guardar(extracto);
    await this.eventos.publicar([this.eventoDescuento(extracto, cargo, descontar, usuarioId)]);
    return this.detalle(extracto, await this.pagosConvertidos(extracto));
  }

  async confirmar(extractoId: string, movimientoId: string, usuarioId: string): Promise<DetalleExtracto> {
    return this.modificar(extractoId, (e) => e.confirmar(movimientoId, usuarioId, this.reloj.ahora()));
  }

  async rechazar(extractoId: string, movimientoId: string): Promise<DetalleExtracto> {
    return this.modificar(extractoId, (e) => e.rechazar(movimientoId, this.reloj.ahora()));
  }

  async enlazar(extractoId: string, movimientoId: string, soporteId: string, usuarioId: string): Promise<DetalleExtracto> {
    const extracto = await this.exigir(extractoId);
    const pagos = await this.pagosConvertidos(extracto);
    const pago = pagos.find((p) => p.soporteId === soporteId);
    if (!pago) throw new DomainError('PAGO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'La factura no es un pago con tarjeta de este viajero');
    if ((await this.extractos.soportesCruzadosFuera(extracto.id, [soporteId])).has(soporteId)) {
      throw new DomainError('SOPORTE_YA_CONCILIADO', 'CONFLICTO', 'Esa factura ya está cruzada en otro extracto');
    }
    const antes = [...extracto.decisionesCargos];
    extracto.enlazar(movimientoId, { soporteId, legalizacionId: pago.legalizacionId, montoSoporte: pago.totalEnMonedaExtracto }, usuarioId, this.reloj.ahora());
    await this.extractos.guardar(extracto);
    const detalle = await this.detalle(extracto, pagos);
    await this.publicarCambios(detalle, antes);
    return detalle;
  }

  async obtener(extractoId: string, usuarioId: string, roles: readonly string[]): Promise<DetalleExtracto> {
    const extracto = await this.exigir(extractoId);
    if (extracto.titularId !== usuarioId && !veTodo(roles)) {
      throw new DomainError('EXTRACTO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El extracto no existe');
    }
    return this.detalle(extracto, await this.pagosConvertidos(extracto));
  }

  /** Extractos del viajero de una legalización (el viajero ve los suyos; contabilidad, todos). */
  async listarDeLegalizacion(legalizacionId: string, usuarioId: string, roles: readonly string[]): Promise<Extracto[]> {
    const legalizacion = await this.legalizaciones.legalizacion(legalizacionId);
    if (!legalizacion || !(legalizacion.viajeroId === usuarioId || veTodo(roles))) {
      throw new DomainError('LEGALIZACION_NO_ENCONTRADA', 'NO_ENCONTRADO', 'La legalización no existe');
    }
    return this.extractos.listarPorTitular(legalizacion.viajeroId);
  }

  listarRecientes(): Promise<Extracto[]> {
    return this.extractos.listarRecientes(100);
  }

  listarPerfiles() {
    return this.perfiles.listar();
  }

  private async cruzar(extracto: Extracto): Promise<DetalleExtracto> {
    const pagos = await this.pagosConvertidos(extracto);
    const cruzadosEnOtro = await this.extractos.soportesCruzadosFuera(extracto.id, pagos.map((p) => p.soporteId));
    const fijos = extracto.crucesFijos();
    const movimientosFijos = new Set(fijos.map((c) => c.movimientoId));
    const soportesFijos = new Set(fijos.map((c) => c.soporteId));
    const propuestas = conciliar(
      extracto.cargos.filter((m) => !movimientosFijos.has(m.id)).map((m) => ({ movimientoId: m.id, fecha: m.fecha, descripcion: m.descripcion, valor: m.valor })),
      pagos.filter((p) => !cruzadosEnOtro.has(p.soporteId) && !soportesFijos.has(p.soporteId)),
      { ultimos4Extracto: extracto.ultimos4, rechazados: extracto.paresRechazados() },
    );
    extracto.aplicarPropuestas(propuestas, this.reloj.ahora());
    return { extracto, pagos, cruzadosEnOtro };
  }

  private async detalle(extracto: Extracto, pagos: PagoTarjeta[]): Promise<DetalleExtracto> {
    return { extracto, pagos, cruzadosEnOtro: await this.extractos.soportesCruzadosFuera(extracto.id, pagos.map((p) => p.soporteId)) };
  }

  /** Pagos con tarjeta del titular dentro del periodo del extracto (con margen) y su total en la moneda del extracto. */
  private async pagosConvertidos(extracto: Extracto): Promise<PagoTarjeta[]> {
    const { desde, hasta } = extracto.periodo();
    const margen = PARAMETROS_POR_DEFECTO.diasMaximos;
    const pagos = (await this.legalizaciones.pagosConTarjeta(extracto.titularId)).filter((p) => {
      const f = FechaCalendario.of(p.fecha);
      return !f.esAnteriorA(desde.sumarDias(-margen)) && !f.esPosteriorA(hasta);
    });
    return Promise.all(
      pagos.map(async (p): Promise<PagoTarjeta> => {
        const fecha = FechaCalendario.of(p.fecha);
        const total = Money.of(p.total.monto, p.total.moneda);
        let convertido: Money | null = total;
        if (total.moneda !== extracto.moneda) {
          try {
            convertido = total.convertir(await this.tasas.obtener(total.moneda, extracto.moneda, fecha));
          } catch (error) {
            if (!(error instanceof DomainError)) throw error;
            convertido = null;
          }
        }
        return {
          soporteId: p.soporteId,
          legalizacionId: p.legalizacionId,
          fecha,
          emisor: p.emisor,
          ultimos4: p.ultimos4,
          totalOriginal: total,
          totalEnMonedaExtracto: convertido,
        };
      }),
    );
  }

  private async modificar(extractoId: string, accion: (e: Extracto) => void): Promise<DetalleExtracto> {
    const extracto = await this.exigir(extractoId);
    const antes = [...extracto.decisionesCargos];
    accion(extracto);
    await this.extractos.guardar(extracto);
    const detalle = await this.detalle(extracto, await this.pagosConvertidos(extracto));
    await this.publicarCambios(detalle, antes);
    return detalle;
  }

  /** Estado bancario de cada pago y descuentos que dejaron de aplicar (el cargo quedó cruzado). */
  private async publicarCambios(detalle: DetalleExtracto, decisionesAntes: ReadonlyArray<{ movimientoId: string; descontar: boolean }>) {
    await this.publicarEstados(detalle);
    const vigentes = new Set(detalle.extracto.decisionesCargos.map((d) => d.movimientoId));
    const retirados = decisionesAntes.filter((d) => d.descontar && !vigentes.has(d.movimientoId));
    const eventos = retirados.flatMap((d) => {
      const cargo = detalle.extracto.movimientos.find((m) => m.id === d.movimientoId);
      return cargo ? [this.eventoDescuento(detalle.extracto, cargo, false, 'sistema')] : [];
    });
    if (eventos.length) await this.eventos.publicar(eventos);
  }

  /**
   * Publica el estado de cada pago con tarjeta del periodo. Un pago sin cargo solo se marca
   * así si su fecha cae dentro del extracto con margen (si es del último día, el cargo puede
   * llegar en el extracto siguiente).
   */
  private async publicarEstados({ extracto, pagos, cruzadosEnOtro }: DetalleExtracto): Promise<void> {
    const { desde, hasta } = extracto.periodo();
    const ultimoDiaSeguro = hasta.sumarDias(-PARAMETROS_POR_DEFECTO.diasMaximos);
    const ahora = this.reloj.ahora();
    const eventos: EstadoBancarioActualizado[] = [];
    for (const pago of pagos) {
      if (cruzadosEnOtro.has(pago.soporteId)) continue;
      const cruce = extracto.cruces.find((c) => c.soporteId === pago.soporteId);
      const movimiento = cruce && extracto.movimientos.find((m) => m.id === cruce.movimientoId);
      const base = { tipo: 'conciliacion.EstadoBancarioActualizado' as const, agregadoId: extracto.id, ocurridoEn: ahora, legalizacionId: pago.legalizacionId, soporteId: pago.soporteId };
      if (cruce && movimiento && cruce.estado !== 'SUGERIDO') {
        eventos.push({
          ...base,
          estado: 'CRUZADO',
          cargo: { movimientoId: movimiento.id, descripcion: movimiento.descripcion, fecha: movimiento.fecha.toString(), valor: movimiento.valor.toDto() },
        });
      } else if (!cruce && !pago.fecha.esAnteriorA(desde) && !pago.fecha.esPosteriorA(ultimoDiaSeguro)) {
        eventos.push({ ...base, estado: 'SIN_CARGO', cargo: null });
      } else {
        eventos.push({ ...base, estado: 'PENDIENTE', cargo: null });
      }
    }
    if (eventos.length) await this.eventos.publicar(eventos);
  }

  private eventoDescuento(extracto: Extracto, cargo: { id: string; descripcion: string; fecha: FechaCalendario; valor: Money }, descontar: boolean, usuarioId: string): CargoSinSoporteDecidido {
    return {
      tipo: 'conciliacion.CargoSinSoporteDecidido',
      agregadoId: extracto.id,
      ocurridoEn: this.reloj.ahora(),
      legalizacionId: extracto.legalizacionId,
      movimientoId: cargo.id,
      descontar,
      descripcion: cargo.descripcion,
      fecha: cargo.fecha.toString(),
      valor: cargo.valor.toDto(),
      decididoPor: usuarioId,
    };
  }

  private async exigir(id: string): Promise<Extracto> {
    const extracto = await this.extractos.obtenerPorId(id);
    if (!extracto) throw new DomainError('EXTRACTO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El extracto no existe');
    return extracto;
  }

  private async leerArchivo(archivo: Archivo): Promise<string[][]> {
    if (archivo.contenido.length > TAMANO_MAXIMO_EXTRACTO) {
      throw new DomainError('ARCHIVO_MUY_GRANDE', 'VALIDACION', 'El extracto supera 5 MB');
    }
    return this.lector.leer(archivo.contenido, archivo.nombre);
  }
}
