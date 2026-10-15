import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { DomainError } from '@viaticos/shared-kernel';
import type { AlmacenArchivos } from '../application/puertos';

/**
 * Archivos en disco (desarrollo y servidores con volumen). Producción en la nube:
 * otro adaptador (S3 / Azure Blob) con el mismo puerto.
 */
export class AlmacenLocal implements AlmacenArchivos {
  private readonly raiz: string;

  constructor(directorio: string) {
    this.raiz = resolve(directorio);
  }

  async guardar(clave: string, contenido: Buffer): Promise<void> {
    const ruta = this.ruta(clave);
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, contenido, { flag: 'wx' }); // nunca sobrescribe
  }

  async leer(clave: string): Promise<Buffer> {
    try {
      return await readFile(this.ruta(clave));
    } catch {
      throw new DomainError('ARCHIVO_NO_DISPONIBLE', 'NO_ENCONTRADO', 'El archivo no está disponible');
    }
  }

  async eliminar(clave: string): Promise<void> {
    await rm(this.ruta(clave), { force: true });
  }

  /** Las claves las genera el servidor, pero igual se impide salir de la carpeta raíz. */
  private ruta(clave: string): string {
    const ruta = resolve(this.raiz, clave);
    if (!ruta.startsWith(this.raiz + sep)) throw new Error(`Clave de archivo inválida: ${clave}`);
    return ruta;
  }
}
