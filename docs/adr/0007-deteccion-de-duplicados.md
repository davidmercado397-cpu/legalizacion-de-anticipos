# ADR-0007: Capa de detección de facturas duplicadas

- Estado: Aceptada

## Contexto
Una misma factura puede llegar dos veces: el mismo archivo, otra foto del mismo papel, por web y por WhatsApp, o legalizada por dos viajeros distintos.

## Decisión
Motor de dominio `DetectorDuplicados` (patrón Strategy) dentro del módulo `comprobantes`:

1. Se calcula una `HuellaComprobante` con valores normalizados: SHA-256, hash perceptual, clave fiscal, emisor, número, fecha y total.
2. El repositorio de huellas busca **candidatos** por índices (no compara contra toda la base).
3. Cada estrategia evalúa los candidatos y emite coincidencias con severidad `BLOQUEANTE` o `SOSPECHOSA`.
4. Veredicto: `DUPLICADO` (no se admite), `SOSPECHOSO` (se admite con alerta para contabilidad) o `UNICO`.
5. Se ejecuta en la ingesta (hash), después del OCR, al corregir campos y en la conciliación.
6. Índices únicos parciales en PostgreSQL garantizan la unicidad ante peticiones concurrentes.
7. Los comprobantes anulados o rechazados no bloquean.

## Consecuencias
- Agregar una señal nueva (por ejemplo, el movimiento bancario) es añadir una estrategia.
- El hash perceptual se calcula en infraestructura; el dominio solo compara distancias.
