# ADR-0005: Dinero como decimal exacto con moneda obligatoria

- Estado: Aceptada

## Decisión
- `Money` (shared-kernel) usa big.js y siempre lleva moneda ISO-4217 (`USD`, `COP`, `BRL`…). Operar dos monedas distintas lanza error.
- En la API, los montos viajan como **string decimal** (`"1234.50"`), nunca como `number`.
- Las conversiones usan una `TasaCambio` explícita (valor, fecha, fuente), guardada como snapshot.
- Redondeo half-up a 2 decimales.
