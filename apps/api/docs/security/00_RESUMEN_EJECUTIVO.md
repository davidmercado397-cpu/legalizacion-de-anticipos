# Expediente de seguridad: plataforma de anticipos y gastos de viaje

**Para:** comité evaluador de Forsa · **De:** NextByte · **Fecha:** 16 de octubre de 2026 ·
**Propuesta:** NBT-2026-P4

## Para qué es este expediente

En la evaluación de la propuesta, Forsa señaló que los requisitos se cumplían "en papel": faltaba
evidencia de seguridad. Este expediente responde a esa observación. Cada control que se declara
implementado apunta a una prueba que se puede verificar:

- el archivo de código que lo implementa;
- la **prueba automática** que lo comprueba, que corre en cada cambio;
- o el reporte generado por una herramienta, guardado en `evidence/` con fecha y commit.

Donde algo todavía no existe, se dice, con su plan de cierre.

## Controles clave

| Riesgo | Control | Dónde se verifica |
|---|---|---|
| Robo de la cuenta de un administrador o de contabilidad | MFA obligatorio (TOTP) para administradores, contabilidad y el operador de NextByte; contraseñas Argon2id; bloqueo tras 5 intentos; sesiones de 15 minutos con revocación inmediata | Matriz, controles A1–A9 y S1–S4 |
| Un empleado ve gastos de otro, o una compañía ve los de otra | Permisos por rol y por registro. Lo ajeno responde "no encontrado", sin confirmar que existe | C1–C2, con prueba automática |
| Fraude interno | Nadie aprueba lo suyo, tampoco por WhatsApp. Auditoría **inmutable**: ni la aplicación ni alguien con sus credenciales puede editarla o borrarla | C3, L1–L2 |
| El proveedor (NextByte) accede a los datos de Forsa | El rol de operador de NextByte solo gestiona la configuración técnica. **No ve gastos, anticipos ni datos personales** | C4, con prueba automática |
| Mensajes falsos que se hacen pasar por WhatsApp | Firma criptográfica de Meta verificada en cada evento | W1–W3 |
| Fuga de fotos de facturas | Almacenamiento privado; enlaces temporales de 5 minutos, solo para quien tiene permiso | D2 |
| Datos personales enviados a la IA | La IA recibe la foto, no los datos del empleado. Configuración de no entrenamiento y retención cero en OpenRouter | D5, `03_SUBPROCESADORES.md` |
| La IA lee mal o es manipulada por el texto de una factura | Su salida se valida con reglas determinísticas y la persona confirma cada factura. La IA no ejecuta acciones | D6 |
| Pérdida de datos | Respaldo diario cifrado fuera del servidor y prueba de restauración documentada. RPO 24 h, RTO 4 h | `06_CONTINUIDAD_RESPALDOS.md` |
| Vulnerabilidades en el código o en librerías | CI con análisis estático, auditoría de dependencias, búsqueda de secretos, SBOM y cobertura mínima de pruebas | P1–P7 |

## Estado de la evidencia

| Verificación | Resultado |
|---|---|
| Análisis estático de seguridad (bandit) | 0 hallazgos |
| Vulnerabilidades conocidas en dependencias (pip-audit) | 0 |
| Pruebas automáticas, incluidas las de seguridad | Todas aprobadas, cobertura ≥ 85 % (ver `evidence/tests.txt` y `evidence/coverage.json`) |
| Reglas de arquitectura (import-linter) | 3 de 3 cumplidas |
| Mínimo privilegio en base de datos | Verificado con roles reales (`evidence/db_least_privilege.txt`) |
| Prueba de restauración | Ejecutada (`evidence/restore_drill.txt`); falta repetirla con volumen real |

## Brechas declaradas y plan

| Brecha | Plan | Cuándo |
|---|---|---|
| NextByte **no tiene certificación ISO 27001**. Se muestra la alineación de los controles con el Anexo A, no una certificación | Mantener la matriz al día. Certificar si el volumen de clientes lo justifica | No comprometido |
| Sin **prueba de penetración externa** | Contratarla con un tercero independiente sobre staging | Antes de salir a producción |
| Sin **monitoreo con alertas 24/7** ni SLA firmado | Monitoreo de disponibilidad y errores con alertas, y propuesta de SLA | Siguiente entregable, si Forsa lo prioriza |
| Respaldo diario aún no programado en producción | Programarlo al desplegar y repetir la prueba de restauración con datos | Al desplegar |
| Retención de 10 años | Política documentada; la supresión del contacto de exempleados ya está implementada (`04_PROTECCION_DE_DATOS.md`) | Validar el plazo con el área legal de Forsa |
| Escaneo dinámico (OWASP ZAP baseline) | Se agrega a la CI contra staging | Al desplegar staging |
| Textos legales (aviso de privacidad y acuerdo de tratamiento de datos) | Borradores incluidos; los revisa el área legal de Forsa | Antes del piloto |

## Contenido

1. `01_ARQUITECTURA_Y_FLUJOS.md`: componentes, flujo de datos, fronteras de confianza y clasificación
   de datos.
2. `02_MATRIZ_DE_CONTROLES.md`: controles con referencia OWASP ASVS e ISO 27001, estado y evidencia.
3. `03_SUBPROCESADORES.md`: Meta, Cloudflare, OpenRouter, proveedores de IA y hosting: qué datos
   recibe cada uno y sus certificaciones, con enlace a la fuente oficial.
4. `04_PROTECCION_DE_DATOS.md`: Ley 1581 de 2012, transferencia internacional, retención y borrador
   del acuerdo de tratamiento.
5. `05_RESPUESTA_A_INCIDENTES.md`: detección, severidad, contención, avisos y plazos.
6. `06_CONTINUIDAD_RESPALDOS.md`: RPO, RTO, respaldos y prueba de restauración.
7. `07_DESARROLLO_SEGURO.md`: ciclo de cambios, CI y gestión de secretos.
8. `evidence/`: reportes generados, con fecha y commit.
