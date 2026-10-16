import { createHash } from 'node:crypto';
import { DomainError, FechaCalendario, Money } from '@viaticos/shared-kernel';
import type { GeneradorIds, ProveedorTasaCambio, Reloj } from '../../../shared/application/puertos';
import { conciliar, PARAMETROS_POR_DEFECTO, type PagoTarjeta } from '../domain/conciliador';
import { Extracto, type ExtractoRepository, type PerfilExtractoRepository } from '../domain/extracto';
import { leerMovimientos, type PerfilExtracto } from '../domain/perfil-extracto';
import { sugerirPerfil } from '../domain/sugerir-perfil';
import type { ConsultaLegalizaciones, LectorTabular } from './puertos';

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
    const legalizacion = await this.legalizaciones.legalizacion(datos.legalizacionId);
    if (!legalizacion || !(legalizacion.viajeroId === datos.usuarioId || datos.roles.includes('CONTABILIDAD'))) {
      throw new DomainError('LEGALIZACION_NO_ENCONTRADA', 'NO_ENCONTRADO', 'La legalización no existe');
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
    const detalle = await this.cruzar(extracto);
    await this.extractos.guardar(extracto);
    return detalle;
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
    extracto.enlazar(movimientoId, { soporteId, legalizacionId: pago.legalizacionId, montoSoporte: pago.totalEnMonedaExtracto }, usuarioId, this.reloj.ahora());
    await this.extractos.guardar(extracto);
    return this.detalle(extracto, pagos);
  }

  async obtener(extractoId: string, usuarioId: string, roles: readonly string[]): Promise<DetalleExtracto> {
    const extracto = await this.exigir(extractoId);
    if (extracto.titularId !== usuarioId && !roles.includes('CONTABILIDAD')) {
      throw new DomainError('EXTRACTO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El extracto no existe');
    }
    return this.detalle(extracto, await this.pagosConvertidos(extracto));
  }

  /** Extractos del viajero de una legalización (el viajero ve los suyos; contabilidad, todos). */
  async listarDeLegalizacion(legalizacionId: string, usuarioId: string, roles: readonly string[]): Promise<Extracto[]> {
    const legalizacion = await this.legalizaciones.legalizacion(legalizacionId);
    if (!legalizacion || !(legalizacion.viajeroId === usuarioId || roles.includes('CONTABILIDAD'))) {
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
    accion(extracto);
    await this.extractos.guardar(extracto);
    return this.detalle(extracto, await this.pagosConvertidos(extracto));
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
