# ADR-0004: PostgreSQL + Drizzle + pg-boss

- Estado: Aceptada (implementación en la iteración 2)

## Contexto
≈50 facturas/día. Hay que procesar OCR, envíos a Siesa y notificaciones de forma asíncrona y confiable.

## Decisión
- PostgreSQL como única base de datos, con Drizzle ORM detrás de los puertos de repositorio.
- pg-boss (cola sobre PostgreSQL) para trabajos asíncronos y el patrón Outbox, sin un broker adicional.

## Consecuencias
- Menos infraestructura que operar. Si el volumen crece mucho, la cola se puede reemplazar por un broker detrás del mismo puerto.
