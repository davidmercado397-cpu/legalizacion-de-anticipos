import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Capas de la web (DESIGN.md y la arquitectura del monorepo):
 *   contracts → client-api → client-app → web.
 * La web pide datos con los hooks de client-app; react-query y axios solo se conocen en la raíz de composición
 * (src/app, src/main.tsx). De client-api se usan tipos; sus valores, solo en la raíz y en lib/errores.
 * Dentro de la web: ui no sabe de features ni de rutas, lib es la base, y las features no importan rutas.
 */
const SOLO_RAIZ = [
  { name: '@tanstack/react-query', message: 'Usa los hooks de @viaticos/client-app; react-query solo vive en src/app.' },
  { name: 'axios', message: 'La web no habla HTTP: usa los hooks de @viaticos/client-app.' },
];
const SOLO_TIPOS_DE_CLIENT_API = {
  group: ['@viaticos/client-api'],
  allowTypeImports: true,
  message: 'De client-api solo tipos; para errores usa lib/errores y para datos los hooks de client-app.',
};
const restringir = (...patrones) => ['error', { paths: SOLO_RAIZ, patterns: [SOLO_TIPOS_DE_CLIENT_API, ...patrones] }];

export default tseslint.config(
  { ignores: ['dist', 'src/routeTree.gen.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': restringir(),
    },
  },
  {
    files: ['src/ui/**'],
    rules: {
      'no-restricted-imports': restringir({ group: ['**/features/**', '**/routes/**'], message: 'ui es genérica: no conoce features ni rutas.' }),
    },
  },
  {
    files: ['src/lib/**'],
    ignores: ['src/lib/errores.ts'],
    rules: {
      'no-restricted-imports': restringir({
        group: ['**/features/**', '**/routes/**', '**/ui/**'],
        message: 'lib es la base: no importa ui, features ni rutas.',
      }),
    },
  },
  {
    files: ['src/features/**'],
    rules: {
      'no-restricted-imports': restringir({ group: ['**/routes/**'], message: 'Una feature no importa rutas: la ruta compone features.' }),
    },
  },
  {
    // Raíz de composición, lib/errores (traduce ApiError) y pruebas: aquí sí se conocen las piezas concretas.
    files: ['src/app/**', 'src/main.tsx', 'src/lib/errores.ts', 'test/**', 'vite.config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
);
