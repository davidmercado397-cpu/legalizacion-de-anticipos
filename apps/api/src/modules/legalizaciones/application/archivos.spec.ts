import { describe, expect, it } from 'vitest';
import { inspeccionarArchivo } from './archivos';

describe('inspeccionarArchivo', () => {
  it('reconoce el tipo por la firma del contenido y calcula el SHA-256', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(inspeccionarArchivo(jpeg)).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' });
    expect(inspeccionarArchivo(Buffer.from('%PDF-1.7 ...'))).toMatchObject({ mime: 'application/pdf' });
    expect(inspeccionarArchivo(jpeg).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rechaza contenido que no es imagen ni PDF, aunque diga ser .jpg', () => {
    expect(() => inspeccionarArchivo(Buffer.from('<svg onload=alert(1)>'))).toThrowError(/Solo se aceptan/);
    expect(() => inspeccionarArchivo(Buffer.from('MZ\x90\x00'))).toThrowError(/Solo se aceptan/);
  });

  it('rechaza vacíos y archivos de más de 10 MB', () => {
    expect(() => inspeccionarArchivo(Buffer.alloc(0))).toThrowError(/vacío/);
    expect(() => inspeccionarArchivo(Buffer.alloc(10 * 1024 * 1024 + 1, 0xff))).toThrowError(/10 MB/);
  });
});
