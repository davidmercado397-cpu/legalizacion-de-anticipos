import { DomainError, FechaCalendario, Money, type MoneyDto, type TasaCambio } from '@viaticos/shared-kernel';
import type { Bitacora, GeneradorIds, ProveedorTasaCambio, PublicadorEventos, Reloj } from '../../../shared/application/puertos';
import { Legalizacion, type EstadoLegalizacion } from '../domain/legalizacion';
import type { PoliticaLegalizacion, PoliticaLegalizacionRepository } from '../domain/politica';
import { ReglaExclusion, type ConfiguracionExclusion } from '../domain/reglas-exclusion';
import type { LegalizacionRepository } from '../domain/repositorios';
import type { CategoriaGasto, EntradaSoporte, MedioPago, TipoClaveFiscal } from '../domain/tipos';
import { inspeccionarArchivo } from './archivos';
import type { AlmacenArchivos, ColaTrabajos, ControlDuplicadosPort, ExtractorComprobantes } from './puertos';

export interface DatosConfirmacion {
  emisorNombre: string;
  emisorId?: string | null | undefined;
  adquirienteId?: string | null | undefined;
  numeroDocumento?: string | null | undefined;
  fecha: string;
  moneda: string;
  total: string;
  claveFiscal?: { tipo: TipoClaveFiscal; valor: string } | null | undefined;
  medioPago: MedioPago;
  ultimos4Tarjeta?: string | null | undefined;
  paisCodigo: string;
  categoria: CategoriaGasto;
  lineas: Array<{ descripcion: string; valor: string }>;
  propinaSugerida?: string | null | undefined;
}

export interface DatosReciboCaja {
  descripcion: string;
  fecha: string;
  moneda: string;
  valor: string;
  categoria: CategoriaGasto;
  medioPago: MedioPago;
  paisCodigo: string;
  beneficiario?: string | null | undefined;
}

export interface ArchivoSubido {
  nombre: string;
  contenido: Buffer;
}

const MAX_REINTENTOS_CONFLICTO = 3;

export interface PagoConTarjeta {
  soporteId: string;
  legalizacionId: string;
  fecha: string;
  total: { monto: string; moneda: string };
  emisor: string;
  ultimos4: string | null;
  numeroDocumento: string | null;
}

export class GestionLegalizaciones {
  constructor(
    private readonly legalizaciones: LegalizacionRepository,
    private readonly politica: PoliticaLegalizacionRepository,
    private readonly almacen: AlmacenArchivos,
    private readonly extractor: ExtractorComprobantes,
    private readonly cola: ColaTrabajos,
    private readonly duplicados: ControlDuplicadosPort,
    private readonly tasas: ProveedorTasaCambio,
    private readonly ids: GeneradorIds,
    private readonly reloj: Reloj,
    private readonly eventos: PublicadorEventos,
    private readonly bitacora: Bitacora,
  ) {}

  /** Reacción a AnticipoDesembolsado. Idempotente: una legalización por anticipo. */
  async abrirParaAnticipo(datos: {
    anticipoId: string;
    viajeroId: string;
    monto: MoneyDto;
    viajeInicio: string;
    viajeFin: string;
  }): Promise<Legalizacion> {
    const existente = await this.legalizaciones.obtenerPorAnticipo(datos.anticipoId);
    if (existente) return existente;
    const legalizacion = Legalizacion.abrir({
      id: this.ids.nuevo(),
      anticipoId: datos.anticipoId,
      viajeroId: datos.viajeroId,
      montoAnticipo: Money.fromDto(datos.monto),
      viaje: { inicio: FechaCalendario.of(datos.viajeInicio), fin: FechaCalendario.of(datos.viajeFin) },
      ahora: this.reloj.ahora(),
    });
    await this.legalizaciones.guardar(legalizacion);
    return legalizacion;
  }

  // ---------------- Viajero ----------------

  /**
   * Sube la foto/PDF: valida el tipo real, descarta duplicados exactos ANTES de
   * guardar y de pagar OCR, y encola la lectura.
   */
  async subirFactura(datos: {
    legalizacionId: string;
    usuarioId: string;
    descripcion: string;
    archivo: ArchivoSubido;
  }): Promise<Legalizacion> {
    const legalizacion = await this.exigirDelViajero(datos.legalizacionId, datos.usuarioId);
    const { mime, ext, sha256 } = inspeccionarArchivo(datos.archivo.contenido);
    if (await this.duplicados.archivoYaRadicado(sha256)) {
      throw new DomainError('COMPROBANTE_DUPLICADO', 'CONFLICTO', 'Este archivo ya fue radicado');
    }

    const soporteId = this.ids.nuevo();
    const archivo = {
      clave: `legalizaciones/${legalizacion.id}/${soporteId}.${ext}`,
      nombre: datos.archivo.nombre.slice(0, 200),
      mime,
      tamano: datos.archivo.contenido.length,
      sha256,
    };
    // La huella del archivo se registra ya: el mismo archivo no puede entrar dos veces, ni antes de confirmarse.
    await this.duplicados.registrar(soporteId, legalizacion.viajeroId, { sha256 });
    try {
      await this.almacen.guardar(archivo.clave, datos.archivo.contenido, mime);
      const actualizada = await this.modificar(datos.legalizacionId, datos.usuarioId, (l) =>
        l.agregarFactura({ soporteId, descripcion: datos.descripcion, archivo, ahora: this.reloj.ahora() }),
      );
      this.encolarExtraccion(actualizada.id, soporteId);
      return actualizada;
    } catch (error) {
      // Compensación: si no quedó registrado el soporte, se libera la huella y el archivo.
      await this.duplicados.anular(soporteId);
      await this.almacen.eliminar(archivo.clave).catch(() => undefined);
      throw error;
    }
  }

  encolarExtraccion(legalizacionId: string, soporteId: string): void {
    this.cola.encolar(`extraccion:${soporteId}`, () => this.procesarExtraccion(legalizacionId, soporteId));
  }

  /** Trabajo en segundo plano: OCR y registro del resultado (reintenta si hubo una edición concurrente). */
  async procesarExtraccion(legalizacionId: string, soporteId: string): Promise<void> {
    let extraccion = undefined as Awaited<ReturnType<ExtractorComprobantes['extraer']>> | undefined;
    for (let intento = 1; intento <= MAX_REINTENTOS_CONFLICTO; intento++) {
      const legalizacion = await this.legalizaciones.obtenerPorId(legalizacionId);
      const soporte = legalizacion?.soportes.find((s) => s.id === soporteId);
      if (!legalizacion || !soporte || soporte.estado !== 'PROCESANDO') return;

      if (extraccion === undefined) {
        extraccion = await this.extraerSinFallar(soporte.archivo!.clave, soporte.archivo!.mime, soporte.descripcionUsuario);
      }
      legalizacion.registrarExtraccion(soporteId, extraccion, this.reloj.ahora());
      try {
        await this.legalizaciones.guardar(legalizacion);
        return;
      } catch (error) {
        if (!(error instanceof DomainError && error.codigo === 'CONFLICTO_CONCURRENCIA') || intento === MAX_REINTENTOS_CONFLICTO) throw error;
      }
    }
  }

  async confirmarSoporte(datos: {
    legalizacionId: string;
    soporteId: string;
    usuarioId: string;
    soporte: DatosConfirmacion;
  }): Promise<Legalizacion> {
    const legalizacion = await this.exigirDelViajero(datos.legalizacionId, datos.usuarioId);
    const actual = legalizacion.soporte(datos.soporteId);
    const d = datos.soporte;
    const total = Money.of(d.total, d.moneda);
    const fecha = FechaCalendario.of(d.fecha);
    const tasa = await this.tasaHacia(total.moneda, legalizacion.montoAnticipo.moneda, fecha);

    const datosSoporte: EntradaSoporte = {
      emisorNombre: d.emisorNombre.trim(),
      emisorId: d.emisorId?.trim() || null,
      adquirienteId: d.adquirienteId?.trim() || null,
      numeroDocumento: d.numeroDocumento?.trim() || null,
      fecha,
      total,
      claveFiscal: d.claveFiscal ?? null,
      medioPago: d.medioPago,
      ultimos4Tarjeta: d.medioPago === 'TARJETA' ? d.ultimos4Tarjeta?.trim() || null : null,
      paisCodigo: d.paisCodigo.toUpperCase(),
      categoria: d.categoria,
      lineas: d.lineas.map((l) => ({ descripcion: l.descripcion.trim(), valor: Money.of(l.valor, total.moneda) })),
      propinaSugerida: d.propinaSugerida ? Money.of(d.propinaSugerida, total.moneda) : null,
      tasa,
    };

    // La huella completa (CUFE, emisor + número, fecha + total) bloquea duplicados en toda la empresa.
    const duplicidad = await this.duplicados.registrar(actual.id, legalizacion.viajeroId, {
      sha256: actual.archivo!.sha256,
      claveFiscal: datosSoporte.claveFiscal,
      emisorId: datosSoporte.emisorId,
      numeroDocumento: datosSoporte.numeroDocumento,
      fecha: d.fecha,
      total: total.toDto(),
    });

    const politica = await this.politica.obtener();
    const contexto = { nitEmpresa: politica.nitEmpresa, reglas: politica.exclusiones.map((c) => new ReglaExclusion(c)), duplicidad };
    return this.modificar(datos.legalizacionId, datos.usuarioId, (l) =>
      l.confirmarSoporte(datos.soporteId, datosSoporte, contexto, this.reloj.ahora()),
    );
  }

  async agregarReciboCaja(datos: {
    legalizacionId: string;
    usuarioId: string;
    recibo: DatosReciboCaja;
    archivo: ArchivoSubido | null;
  }): Promise<Legalizacion> {
    const legalizacion = await this.exigirDelViajero(datos.legalizacionId, datos.usuarioId);
    if (!datos.archivo) {
      throw new DomainError('FOTO_RECIBO_REQUERIDA', 'VALIDACION', 'Adjunte la foto del recibo firmado por quien le vendió');
    }
    const r = datos.recibo;
    const valor = Money.of(r.valor, r.moneda);
    const fecha = FechaCalendario.of(r.fecha);
    const monedaAnticipo = legalizacion.montoAnticipo.moneda;
    const politica = await this.politica.obtener();

    // Tope en la moneda del recibo; si no hay, se compara en la moneda del anticipo.
    let tope = politica.topesReciboCaja.find((t) => t.moneda === valor.moneda);
    let valorEnMonedaTope = valor;
    if (!tope) {
      tope = politica.topesReciboCaja.find((t) => t.moneda === monedaAnticipo);
      if (!tope) {
        throw new DomainError('TOPE_NO_CONFIGURADO', 'REGLA_NEGOCIO', 'Contabilidad no ha configurado el tope de recibos de caja');
      }
      valorEnMonedaTope = valor.convertir((await this.tasaHacia(valor.moneda, tope.moneda, fecha))!);
    }

    const soporteId = this.ids.nuevo();
    let archivo = null;
    if (datos.archivo) {
      const { mime, ext, sha256 } = inspeccionarArchivo(datos.archivo.contenido);
      archivo = { clave: `legalizaciones/${legalizacion.id}/${soporteId}.${ext}`, nombre: datos.archivo.nombre.slice(0, 200), mime, tamano: datos.archivo.contenido.length, sha256 };
    }

    const tasa = await this.tasaHacia(valor.moneda, monedaAnticipo, fecha);
    if (archivo && datos.archivo) {
      await this.duplicados.registrar(soporteId, legalizacion.viajeroId, { sha256: archivo.sha256 });
      await this.almacen.guardar(archivo.clave, datos.archivo.contenido, archivo.mime);
    }
    const reciboDatos = {
      soporteId,
      descripcion: r.descripcion,
      fecha,
      valor,
      categoria: r.categoria,
      medioPago: r.medioPago,
      paisCodigo: r.paisCodigo.toUpperCase(),
      beneficiario: r.beneficiario ?? null,
      archivo,
      tasa,
      tope: { tope, valorEnMonedaTope },
    };
    try {
      return await this.modificar(datos.legalizacionId, datos.usuarioId, (l) => l.agregarReciboCaja({ ...reciboDatos, ahora: this.reloj.ahora() }));
    } catch (error) {
      if (archivo) {
        await this.duplicados.anular(soporteId);
        await this.almacen.eliminar(archivo.clave).catch(() => undefined);
      }
      throw error;
    }
  }

  async eliminarSoporte(datos: { legalizacionId: string; soporteId: string; usuarioId: string }): Promise<Legalizacion> {
    let archivo: { clave: string } | null = null;
    const legalizacion = await this.modificar(datos.legalizacionId, datos.usuarioId, (l) => {
      archivo = l.soporte(datos.soporteId).archivo;
      l.eliminarSoporte(datos.soporteId, this.reloj.ahora());
    });
    await this.duplicados.anular(datos.soporteId);
    const clave = (archivo as { clave: string } | null)?.clave;
    if (clave) await this.almacen.eliminar(clave).catch(() => undefined);
    await this.eventos.publicar(legalizacion.extraerEventos());
    return legalizacion;
  }

  enviar(legalizacionId: string, usuarioId: string): Promise<Legalizacion> {
    return this.modificar(legalizacionId, null, (l) => l.enviarARevision(usuarioId, this.reloj.ahora()));
  }

  // ---------------- Contabilidad ----------------

  async decidirLinea(datos: { legalizacionId: string; soporteId: string; indice: number; excluir: boolean; contadorId: string }): Promise<Legalizacion> {
    return this.modificar(datos.legalizacionId, null, (l) =>
      l.decidirLinea(datos.soporteId, datos.indice, datos.excluir, datos.contadorId, this.reloj.ahora()),
    );
  }

  async decidirSoporte(datos: {
    legalizacionId: string;
    soporteId: string;
    contadorId: string;
    aplica: boolean;
    comentario?: string | undefined;
  }): Promise<Legalizacion> {
    return this.modificar(datos.legalizacionId, null, (l) =>
      l.decidirSoporte(
        datos.soporteId,
        { aplica: datos.aplica, comentario: datos.comentario ?? null, contadorId: datos.contadorId },
        this.reloj.ahora(),
      ),
    );
  }

  async aprobar(legalizacionId: string, contadorId: string): Promise<Legalizacion> {
    const legalizacion = await this.modificar(legalizacionId, null, (l) => l.aprobar(contadorId, this.reloj.ahora()));
    await this.eventos.publicar(legalizacion.extraerEventos());
    return legalizacion;
  }

  async devolver(legalizacionId: string, contadorId: string, comentario: string): Promise<Legalizacion> {
    return this.modificar(legalizacionId, null, (l) => l.devolver(contadorId, comentario, this.reloj.ahora()));
  }

  obtenerPolitica(): Promise<PoliticaLegalizacion> {
    return this.politica.obtener();
  }

  async actualizarPolitica(datos: {
    contadorId: string;
    nitEmpresa: string;
    topesReciboCaja: MoneyDto[];
    exclusiones: ConfiguracionExclusion[];
  }): Promise<PoliticaLegalizacion> {
    const monedas = datos.topesReciboCaja.map((t) => t.moneda);
    if (new Set(monedas).size !== monedas.length) {
      throw new DomainError('TOPE_DUPLICADO', 'VALIDACION', 'Configure un solo tope por moneda');
    }
    const politica: PoliticaLegalizacion = {
      nitEmpresa: datos.nitEmpresa.trim(),
      topesReciboCaja: datos.topesReciboCaja.map(Money.fromDto),
      exclusiones: datos.exclusiones.map((e) => ({
        ...e,
        palabras: [...new Set(e.palabras.map((p) => p.trim()).filter(Boolean))],
        palabrasAmbiguas: [...new Set((e.palabrasAmbiguas ?? []).map((p) => p.trim()).filter(Boolean))],
      })),
      actualizadaPor: datos.contadorId,
      actualizadaEn: this.reloj.ahora(),
    };
    await this.politica.guardar(politica);
    return politica;
  }

  // ---------------- Consultas ----------------

  async obtenerPara(legalizacionId: string, usuarioId: string, roles: readonly string[]): Promise<Legalizacion> {
    const legalizacion = await this.legalizaciones.obtenerPorId(legalizacionId);
    if (!legalizacion || !legalizacion.puedeVer(usuarioId, roles)) throw noEncontrada();
    return legalizacion;
  }

  async obtenerPorAnticipo(anticipoId: string, usuarioId: string, roles: readonly string[]): Promise<Legalizacion> {
    const legalizacion = await this.legalizaciones.obtenerPorAnticipo(anticipoId);
    if (!legalizacion || !legalizacion.puedeVer(usuarioId, roles)) throw noEncontrada();
    return legalizacion;
  }

  listarPorEstados(estados: readonly EstadoLegalizacion[]): Promise<Legalizacion[]> {
    return this.legalizaciones.listarPorEstados(estados);
  }

  /** Para conciliación bancaria (el módulo que consulta valida los permisos). */
  async titularDe(legalizacionId: string): Promise<{ id: string; viajeroId: string } | null> {
    const legalizacion = await this.legalizaciones.obtenerPorId(legalizacionId);
    return legalizacion && { id: legalizacion.id, viajeroId: legalizacion.viajeroId };
  }

  /** Facturas confirmadas pagadas con tarjeta por el viajero, excepto las que contabilidad rechazó. */
  async pagosConTarjeta(viajeroId: string): Promise<PagoConTarjeta[]> {
    const legalizaciones = await this.legalizaciones.listarPorViajero(viajeroId);
    return legalizaciones.flatMap((l) =>
      l.soportes.flatMap((s) =>
        s.tipo === 'FACTURA' && s.estado === 'CONFIRMADO' && s.datos?.medioPago === 'TARJETA' && s.decision?.aplica !== false
          ? [
              {
                soporteId: s.id,
                legalizacionId: l.id,
                fecha: s.datos.fecha.toString(),
                total: s.datos.total.toJSON(),
                emisor: s.datos.emisorNombre,
                ultimos4: s.datos.ultimos4Tarjeta,
                numeroDocumento: s.datos.numeroDocumento,
              },
            ]
          : [],
      ),
    );
  }

  async leerArchivo(datos: { legalizacionId: string; soporteId: string; usuarioId: string; roles: readonly string[] }) {
    const legalizacion = await this.obtenerPara(datos.legalizacionId, datos.usuarioId, datos.roles);
    const archivo = legalizacion.soporte(datos.soporteId).archivo;
    if (!archivo) throw new DomainError('SIN_ARCHIVO', 'NO_ENCONTRADO', 'El soporte no tiene archivo');
    return { contenido: await this.almacen.leer(archivo.clave), mime: archivo.mime, nombre: archivo.nombre };
  }

  /** Al arrancar: reencola las lecturas que quedaron a medias (reinicio del servidor). */
  async reanudarPendientes(): Promise<number> {
    const pendientes = await this.legalizaciones.listarSoportesProcesando();
    pendientes.forEach((p) => this.encolarExtraccion(p.legalizacionId, p.soporteId));
    return pendientes.length;
  }

  // ---------------- Privados ----------------

  /**
   * Carga → aplica la regla de dominio → guarda. Si otra operación (p. ej. la
   * lectura OCR en segundo plano) guardó en medio, recarga y reintenta.
   */
  private async modificar(id: string, viajeroId: string | null, accion: (l: Legalizacion) => void): Promise<Legalizacion> {
    for (let intento = 1; ; intento++) {
      const legalizacion = viajeroId ? await this.exigirDelViajero(id, viajeroId) : await this.exigir(id);
      accion(legalizacion);
      try {
        await this.legalizaciones.guardar(legalizacion);
        return legalizacion;
      } catch (error) {
        const conflicto = error instanceof DomainError && error.codigo === 'CONFLICTO_CONCURRENCIA';
        if (!conflicto || intento >= MAX_REINTENTOS_CONFLICTO) throw error;
      }
    }
  }

  private async extraerSinFallar(clave: string, mime: string, descripcionUsuario: string) {
    if (!this.extractor.automatico) return null;
    try {
      return await this.extractor.extraer({ contenido: await this.almacen.leer(clave), mime, descripcionUsuario, paisesViaje: [] });
    } catch (error) {
      // Si la lectura automática falla, el viajero digita los datos: nunca se bloquea la legalización.
      this.bitacora.advertencia(`Lectura automática fallida (${clave}): ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async tasaHacia(origen: string, destino: string, fecha: FechaCalendario): Promise<TasaCambio | null> {
    return origen === destino ? null : this.tasas.obtener(origen, destino, fecha);
  }

  private async exigir(id: string): Promise<Legalizacion> {
    const legalizacion = await this.legalizaciones.obtenerPorId(id);
    if (!legalizacion) throw noEncontrada();
    return legalizacion;
  }

  private async exigirDelViajero(id: string, usuarioId: string): Promise<Legalizacion> {
    const legalizacion = await this.exigir(id);
    if (legalizacion.viajeroId !== usuarioId) throw noEncontrada();
    return legalizacion;
  }
}

const noEncontrada = () => new DomainError('LEGALIZACION_NO_ENCONTRADA', 'NO_ENCONTRADO', 'La legalización no existe');
