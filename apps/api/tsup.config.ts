import { defineConfig } from 'tsup';

export default defineConfig({
  // main: servidor · cli: tareas de base de datos (node dist/cli.js migrar | sembrar)
  entry: { main: 'src/main.ts', cli: 'src/database/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Los paquetes del workspace se publican como TS fuente: se empaquetan dentro del bundle.
  noExternal: [/^@viaticos\//],
});
