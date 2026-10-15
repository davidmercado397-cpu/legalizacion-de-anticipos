# ADR-0001: Monorepo TypeScript con pnpm workspaces

- Estado: Aceptada

## Contexto
El backend, la web y la futura app móvil deben compartir contratos (validaciones), tipos de dinero/moneda y reglas puras. El equipo quiere TypeScript en todo el stack.

## Decisión
Monorepo con pnpm workspaces. Los paquetes compartidos se consumen como código fuente TypeScript (`exports` apunta a `src/index.ts`); cada app los transpila (Vite en web, esbuild/tsx en la API).

## Consecuencias
- Una sola fuente de verdad para esquemas Zod (`packages/contracts`) usada por los controladores y por los formularios.
- La API se empaqueta con tsup para producción (incluye los paquetes del workspace).
