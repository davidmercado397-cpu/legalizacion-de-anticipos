import { DomainError, FechaCalendario, Money } from '@viaticos/shared-kernel';
import type { GeneradorIds } from '../../../shared/application/puertos';
import type { ConceptoViatico, UnidadCobro } from '../domain/concepto-viatico';
import type { ConceptoViaticoRepository, TarifaRepository } from '../domain/repositorios';
import { Tarifa } from '../domain/tarifa';

export interface NuevaTarifa {
  cargoId: string;
  paisCodigo: string;
  conceptoCodigo: string;
  valor: string;
  moneda: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

/**
 * Contabilidad administra los conceptos de viático y la matriz de tarifas
 * (cargo × país × concepto). Una tarifa nueva para la misma combinación cierra
 * la anterior el día antes; nunca se borran tarifas, para conservar el historial.
 */
export class AdministrarTarifasUseCase {
  constructor(
    private readonly tarifas: TarifaRepository,
    private readonly conceptos: ConceptoViaticoRepository,
    private readonly ids: GeneradorIds,
  ) {}

  listarConceptos(): Promise<ConceptoViatico[]> {
    return this.conceptos.listar();
  }

  async guardarConcepto(datos: { codigo: string; nombre: string; unidad: UnidadCobro; activo: boolean }): Promise<ConceptoViatico> {
    const codigo = datos.codigo.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(codigo)) {
      throw new DomainError('CODIGO_INVALIDO', 'VALIDACION', 'El código usa mayúsculas, números y guion bajo (ej. LAVANDERIA)');
    }
    const concepto = { codigo, nombre: datos.nombre.trim(), unidad: datos.unidad, activo: datos.activo };
    await this.conceptos.guardar(concepto);
    return concepto;
  }

  listarTarifas(filtro: { cargoId?: string | undefined; paisCodigo?: string | undefined }): Promise<Tarifa[]> {
    return this.tarifas.listar({ cargoId: filtro.cargoId, paisCodigo: filtro.paisCodigo?.toUpperCase() });
  }

  async crearTarifa(datos: NuevaTarifa): Promise<Tarifa> {
    const conceptos = await this.conceptos.listar();
    if (!conceptos.some((c) => c.codigo === datos.conceptoCodigo)) {
      throw new DomainError('CONCEPTO_NO_ENCONTRADO', 'NO_ENCONTRADO', `No existe el concepto ${datos.conceptoCodigo}`);
    }
    const nueva = Tarifa.crear({
      id: this.ids.nuevo(),
      cargoId: datos.cargoId.trim().toUpperCase(),
      paisCodigo: datos.paisCodigo.trim().toUpperCase(),
      conceptoCodigo: datos.conceptoCodigo,
      valorUnitario: Money.of(datos.valor, datos.moneda.toUpperCase()),
      vigenteDesde: FechaCalendario.of(datos.vigenteDesde),
      vigenteHasta: datos.vigenteHasta ? FechaCalendario.of(datos.vigenteHasta) : null,
    });

    const existentes = await this.tarifas.buscarPorCargoYPais(nueva.cargoId, nueva.paisCodigo);
    const cambios: Tarifa[] = [];
    for (const actual of existentes.filter((t) => t.seSolapaCon(nueva))) {
      // La tarifa abierta que empezó antes se cierra el día anterior a la nueva.
      if (actual.vigenteHasta === null && actual.vigenteDesde.esAnteriorA(nueva.vigenteDesde)) {
        cambios.push(actual.cerrarEn(nueva.vigenteDesde.sumarDias(-1)));
      } else {
        throw new DomainError(
          'TARIFAS_SOLAPADAS',
          'CONFLICTO',
          `Ya hay una tarifa de ${nueva.conceptoCodigo} para ${nueva.cargoId} en ${nueva.paisCodigo} que cubre esas fechas`,
          { tarifa: actual.id },
        );
      }
    }
    await this.tarifas.guardar([...cambios, nueva]);
    return nueva;
  }

  /** Termina la vigencia de una tarifa (deja de aplicarse desde el día siguiente). */
  async cerrarTarifa(id: string, hasta: string): Promise<Tarifa> {
    const tarifa = await this.tarifas.obtenerPorId(id);
    if (!tarifa) throw new DomainError('TARIFA_NO_ENCONTRADA', 'NO_ENCONTRADO', 'La tarifa no existe');
    const cerrada = tarifa.cerrarEn(FechaCalendario.of(hasta));
    await this.tarifas.guardar([cerrada]);
    return cerrada;
  }
}
