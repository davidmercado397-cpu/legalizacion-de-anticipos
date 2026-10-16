# 6. Continuidad y respaldos

## Objetivos

| Indicador | Compromiso | Cómo se logra |
|---|---|---|
| **RPO** (datos que se pueden perder como máximo) | 24 horas | Respaldo lógico diario de PostgreSQL |
| **RTO** (tiempo para volver a operar) | 4 horas | Restaurar el último respaldo y redesplegar el contenedor |

Las fotos de las facturas viven en Cloudflare R2, que replica los objetos dentro de su
infraestructura (ver `03_SUBPROCESADORES.md`). No dependen del respaldo de la base de datos.

## Qué se respalda

| Elemento | Cómo | Frecuencia | Retención propuesta |
|---|---|---|---|
| Base de datos (usuarios, anticipos, gastos, auditoría, configuración) | `scripts/backup_db.sh`: `pg_dump` comprimido más su suma SHA-256 | Diaria y antes de cada despliegue con migraciones | 30 diarios y 12 mensuales |
| Copia fuera del servidor | El mismo script la cifra con AES-256 (llave en el gestor de secretos, nunca en la BD) y la sube a un bucket R2 distinto al de las facturas | Diaria | Igual a la anterior |
| Fotos de facturas | Cloudflare R2 | Al recibirlas | 10 años (soporte contable, ver `04_PROTECCION_DE_DATOS.md`) |
| Código y configuración | Repositorio Git; los secretos en el gestor de secretos del hosting | Cada cambio | Permanente |

## Prueba de restauración

Un respaldo que nunca se restauró no es un respaldo. `scripts/restore_drill.sh`:

1. verifica la suma SHA-256 del último respaldo;
2. lo restaura en una base temporal (nunca en la de producción);
3. cuenta las filas de las tablas principales y lee la versión del esquema;
4. mide el tiempo de restauración y borra la base temporal.

**Resultado registrado:** `evidence/restore_drill.txt` (16/10/2026). Se ejecutó contra la base de
desarrollo, con el esquema completo (versión 0004) y la configuración del sistema (21 llaves), pero
**sin datos de operación**. Por eso el tiempo medido (segundos) no representa el RTO real; se
repetirá con un volumen comparable al de producción antes del piloto.

**Frecuencia propuesta:** trimestral y después de cada cambio grande de esquema. Cada resultado se
guarda en `evidence/` con su fecha.

## Escenarios

| Escenario | Respuesta |
|---|---|
| Se cae el contenedor de la API | El hosting lo reinicia; `/health` y `/ready` indican el estado. Las fotos de WhatsApp que lleguen mientras tanto las reintenta Meta y, una vez guardadas, las reprocesa el barrido periódico |
| Se cae OpenRouter o el modelo de IA | Respaldo automático a otro modelo (`ai.availability_fallbacks`). Si todos fallan, el gasto queda en cola en PostgreSQL y se procesa al volver el servicio |
| Se cae Meta (WhatsApp) | Los usuarios pueden registrar gastos por la app; WhatsApp se recupera solo cuando Meta vuelve |
| Se cae Redis | La caché se lee directamente de la BD (nunca se sirven datos viejos); los límites de peticiones dejan pasar en vez de bloquear la operación |
| Corrupción o borrado de datos | Restaurar el último respaldo (RPO 24 h). La auditoría no se puede borrar desde la aplicación |
| Pérdida del servidor | Nuevo servidor, despliegue del contenedor desde el repositorio, restauración de la copia cifrada en R2 |

## Pendiente (declarado)

- Programar el respaldo diario en el hosting de producción (Coolify) y la copia cifrada a R2.
- Repetir la prueba de restauración con datos representativos.
- Monitoreo con alertas (ver `00_RESUMEN_EJECUTIVO.md`).
