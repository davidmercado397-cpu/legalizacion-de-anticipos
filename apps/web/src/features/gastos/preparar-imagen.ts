const LADO_MAXIMO = 2000;
const CALIDAD = 0.85;

/**
 * Reduce fotos grandes del celular antes de subirlas (ahorra datos en el exterior).
 * PDF y formatos que el navegador no puede decodificar se envían tal cual; el
 * servidor valida el tipo real.
 */
export async function prepararArchivo(archivo: File): Promise<{ contenido: Blob; nombre: string }> {
  const original = { contenido: archivo as Blob, nombre: archivo.name };
  if (!archivo.type.startsWith('image/') || typeof createImageBitmap !== 'function') return original;
  try {
    const imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height));
    if (escala === 1 && archivo.type === 'image/jpeg' && archivo.size < 1_500_000) return original;
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(imagen.width * escala);
    lienzo.height = Math.round(imagen.height * escala);
    lienzo.getContext('2d')!.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, 'image/jpeg', CALIDAD));
    return blob ? { contenido: blob, nombre: archivo.name.replace(/\.[^.]+$/, '') + '.jpg' } : original;
  } catch {
    return original;
  }
}
