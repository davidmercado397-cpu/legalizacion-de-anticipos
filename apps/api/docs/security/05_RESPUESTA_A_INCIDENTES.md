# 5. Respuesta a incidentes

Procedimiento de NextByte ante un incidente que afecte la plataforma de Forsa. Se prueba con un
simulacro de mesa una vez al año.

## Qué es un incidente

Cualquier evento que comprometa, o pueda comprometer, la confidencialidad, la integridad o la
disponibilidad de la plataforma o de sus datos. Ejemplos:

- acceso no autorizado a una cuenta o a datos;
- fuga de una credencial o un secreto;
- borrado o alteración de datos;
- caída prolongada del servicio;
- vulnerabilidad explotable en el código o en una dependencia;
- incidente reportado por un subprocesador.

## Cómo se detecta

| Fuente | Ejemplo |
|---|---|
| Auditoría y logs | Ráfagas de logins fallidos, reutilización de un refresh token (revoca la sesión sola y queda `refresh_token_reuse` en la auditoría), webhooks con firma inválida |
| Límites de peticiones | Picos de respuestas 429 por usuario o remitente |
| CI de seguridad | pip-audit, bandit o gitleaks con un hallazgo nuevo |
| `/ready` | Una integración caída |
| Reporte de Forsa, de un usuario o de un subprocesador | Correo o mensaje al contacto de seguridad de NextByte |

El monitoreo con alertas automáticas 24/7 está **pendiente** (brecha declarada en el resumen
ejecutivo). Hasta tenerlo, la revisión es manual y diaria en horario hábil.

## Severidad

| Nivel | Criterio | Ejemplo | Primer aviso a Forsa |
|---|---|---|---|
| **Crítica** | Datos personales o financieros expuestos o alterados, o servicio caído más de 4 horas | Acceso no autorizado a la base de datos | Máximo **24 horas** desde que se confirma |
| **Alta** | Riesgo real de exposición, o una función clave caída | Secreto filtrado sin evidencia de uso | Máximo 24 horas |
| **Media** | Riesgo contenido, sin datos expuestos | Vulnerabilidad en una dependencia, ya parcheada | En el informe mensual |
| **Baja** | Sin impacto | Escaneo automático bloqueado por los límites | No se notifica |

## Pasos

1. **Contener:**
   - revocar sesiones: cambiar `token_version` del usuario afectado o rotar `JWT_SECRET` para
     cerrar todas;
   - desactivar cuentas comprometidas;
   - rotar los secretos expuestos (ver `07_DESARROLLO_SEGURO.md`);
   - bloquear el origen.
2. **Preservar la evidencia:**
   - la auditoría es inmutable y no se puede borrar desde la aplicación;
   - copiar los logs del periodo;
   - tomar un respaldo de la base de datos antes de cualquier corrección.
3. **Evaluar:** qué datos, de quiénes, desde cuándo y por qué vía. `GET /api/v1/audit` permite
   filtrar por actor, acción y fechas.
4. **Avisar a Forsa** (plazos de la tabla de severidad): qué pasó, qué datos y titulares están
   afectados, qué se hizo y qué sigue. Se envían actualizaciones hasta cerrar el incidente.
5. **Erradicar y recuperar:**
   - corregir la causa con su prueba automática, que pasa a `tests/security/`;
   - restaurar desde respaldo si hace falta (ver `06_CONTINUIDAD_RESPALDOS.md`).
6. **Post-mortem:** en máximo 10 días hábiles después de cerrar el incidente, un informe con línea
   de tiempo, causa raíz, impacto y acciones preventivas. Se entrega a Forsa en los incidentes
   críticos y altos.

## Reporte a la autoridad (Colombia)

- **Obligación:** la Ley 1581 obliga al Responsable (art. 17, literal n) y al Encargado (art. 18,
  literal k) a informar a la Superintendencia de Industria y Comercio (SIC) cuando haya violaciones
  a los códigos de seguridad y riesgos en la administración de la información de los titulares.
  [Fuente](http://www.secretariasenado.gov.co/senado/basedoc/ley_1581_2012.html)
- **Plazo:** según la Circular Única de la SIC (Título V), el reporte se hace en el Registro
  Nacional de Bases de Datos dentro de los **15 días hábiles** siguientes a que el incidente se
  detecte y llegue a conocimiento del área encargada.
  [Fuente: proyecto de circular de la SIC](https://sedeelectronica.sic.gov.co/sites/default/files/normatividad/CE_Implementacion_RNBD_fase_2.pdf)
  - El texto consolidado vigente de la Circular Única no se pudo consultar al redactar (**no
    verificado**). Debe confirmarlo el área legal de Forsa.
- **Quién reporta:** según un concepto de la SIC de 2021, la obligación aplica también a los
  Encargados, por el módulo "Reporte de incidentes de seguridad".
  [Fuente](https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/cumplimiento-de-la-obligacion-del-reporte-de-incidentes-de-seguridad)
  - Forsa (Responsable) decide la comunicación a los titulares.
  - NextByte (Encargado) entrega a Forsa la información para el reporte dentro de los plazos de
    aviso de este documento, y presenta su propio reporte como Encargado cuando aplique.
- Panamá y México tienen sus propias reglas de notificación: las define el área legal de Forsa.

## Contactos

| Rol | Quién | Medio |
|---|---|---|
| Responsable de seguridad, NextByte | {nombre} | {correo} · {celular} |
| Contacto de seguridad, Forsa | {lo define Forsa} | {correo} · {celular} |
| Oficial de protección de datos, Forsa | {lo define Forsa} | {correo} |

Se completa al firmar el contrato.
