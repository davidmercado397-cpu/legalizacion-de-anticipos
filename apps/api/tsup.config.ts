import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Los paquetes del workspace se publican como TS fuente: se empaquetan dentro del bundle.
  noExternal: [/^@viaticos\//],
});
