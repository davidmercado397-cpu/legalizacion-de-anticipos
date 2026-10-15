# ADR-0003: NestJS solo en presentación y composición, con inyección explícita

- Estado: Aceptada

## Contexto
Los casos de uso deben ser independientes del framework. Las herramientas rápidas (tsx/esbuild/Vitest) no emiten `emitDecoratorMetadata`.

## Decisión
- Los casos de uso y servicios de dominio son clases TypeScript puras, sin decoradores.
- Cada módulo Nest los registra con `useFactory` + `inject` usando tokens (`Symbol`) para los puertos.
- Los controladores usan `@Inject(Token)` explícito; no dependemos de la metadata de tipos.

## Consecuencias
- El mismo código corre en tsx, Vitest y el bundle de producción sin plugins extra.
- Algo más de código de cableado en los `*.module.ts`, a cambio de un dominio portable y fácil de probar.
