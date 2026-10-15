import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Prueba de arquitectura (ADR-0002): falla si se rompe la regla de dependencia.
 *  - domain:      solo shared-kernel, su propio dominio y shared/domain.
 *  - application: además, su capa de aplicación y shared/application. Sin frameworks.
 *  - Un módulo solo usa otro módulo desde infraestructura o desde el *.module.ts,
 *    y únicamente a través de su capa de aplicación (API pública).
 */
const SRC = resolve(__dirname, '../src');
const MODULOS = join(SRC, 'modules');

const archivosTs = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) return archivosTs(ruta);
    return ruta.endsWith('.ts') && !ruta.endsWith('.spec.ts') && !ruta.includes(`${sep}test-support${sep}`) ? [ruta] : [];
  });

const importsDe = (archivo: string) =>
  [...readFileSync(archivo, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

const capaDe = (ruta: string) => relative(MODULOS, ruta).split(sep)[1] ?? '';
const moduloDe = (ruta: string) => relative(MODULOS, ruta).split(sep)[0]!;
const resolverRelativo = (archivo: string, imp: string) => resolve(archivo, '..', imp);

const PAQUETES_PERMITIDOS = {
  domain: ['@viaticos/shared-kernel'],
  // node:crypto es cálculo puro (hash) y estándar de la plataforma; nada de frameworks ni E/S.
  application: ['@viaticos/shared-kernel', 'node:crypto'],
} as const;

function violaciones(): string[] {
  const errores: string[] = [];
  for (const archivo of archivosTs(MODULOS)) {
    const capa = capaDe(archivo);
    const modulo = moduloDe(archivo);
    for (const imp of importsDe(archivo)) {
      const etiqueta = `${relative(SRC, archivo)} → ${imp}`;
      if (!imp.startsWith('.')) {
        if ((capa === 'domain' || capa === 'application') && !(PAQUETES_PERMITIDOS[capa] as readonly string[]).includes(imp)) {
          errores.push(`${etiqueta}: ${capa} no puede depender de paquetes externos`);
        }
        continue;
      }
      const destino = resolverRelativo(archivo, imp);
      const dentroDeModulos = destino.startsWith(MODULOS + sep);
      const capaDestino = dentroDeModulos ? capaDe(destino) : relative(SRC, destino).split(sep)[1];

      if (capa === 'domain') {
        const ok = dentroDeModulos
          ? moduloDe(destino) === modulo && capaDestino === 'domain'
          : relative(SRC, destino).startsWith(join('shared', 'domain'));
        if (!ok) errores.push(`${etiqueta}: el dominio solo depende de su propio dominio`);
      }
      if (capa === 'application') {
        const ok = dentroDeModulos
          ? moduloDe(destino) === modulo && ['domain', 'application'].includes(capaDestino ?? '')
          : ['domain', 'application'].includes(capaDestino ?? '');
        if (!ok) errores.push(`${etiqueta}: application no depende de infraestructura ni de otros módulos`);
      }
      if (dentroDeModulos && moduloDe(destino) !== modulo) {
        const desdeAdaptador = capa === 'infrastructure' || archivo.endsWith('.module.ts');
        if (!desdeAdaptador || capaDestino !== 'application' && !destino.endsWith('.module')) {
          errores.push(`${etiqueta}: otro módulo solo se usa desde infraestructura y vía su capa application`);
        }
      }
    }
  }
  return errores;
}

describe('Arquitectura limpia', () => {
  it('respeta la regla de dependencia entre capas y módulos', () => {
    expect(violaciones()).toEqual([]);
  });

  it('analiza los archivos de todos los módulos', () => {
    expect(archivosTs(MODULOS).length).toBeGreaterThan(10);
    expect(capaDe(join(MODULOS, 'solicitudes', 'domain', 'x.ts'))).toBe('domain');
  });
});
