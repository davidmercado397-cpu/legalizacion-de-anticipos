# 4. Protección de datos personales

Marco: Ley Estatutaria 1581 de 2012 y Decreto 1377 de 2013 (compilado en el Decreto Único
Reglamentario 1074 de 2015). Lo que aquí se dice debe revisarlo el **área legal de Forsa**.
Este documento no es una opinión jurídica.

> Alcance: Colombia. Panamá (Ley 81 de 2019) y México (Ley Federal de Protección de Datos
> Personales en Posesión de los Particulares) tienen reglas propias. Las revisa el área legal de
> Forsa antes de activar esas compañías.

## Roles

| Rol (Ley 1581) | Quién | Qué hace |
|---|---|---|
| Responsable | Cada compañía de Forsa | Decide para qué se tratan los datos de sus empleados |
| Encargado | NextByte | Opera la plataforma por cuenta de Forsa y sigue sus instrucciones |
| Subencargados | Meta, Cloudflare, OpenRouter, Google, Anthropic y el hosting | Ver `03_SUBPROCESADORES.md` |

## Datos que se tratan y para qué

| Datos | Finalidad |
|---|---|
| Nombre, correo, celular, identificador de WhatsApp del empleado | Identificarlo, autenticarlo y enviarle avisos de sus anticipos y gastos |
| Anticipos, gastos, fotos de facturas y decisiones | Control, legalización y contabilización de los gastos de viaje |
| Registros de auditoría (quién hizo qué y cuándo) | Seguridad, control interno y trazabilidad |

**Minimización:**

- No se piden datos sensibles.
- La IA no recibe datos del empleado, solo la foto de la factura.
- El nombre de usuario de WhatsApp se guarda solo como dato informativo.
- A un número no registrado no se le guarda nada ni se le da información.

## Autorización y aviso de privacidad

El empleado recibe el aviso al vincular su WhatsApp, con la plantilla de bienvenida. Su
confirmación ("Sí, soy {nombre}") queda en la auditoría con la fecha y el canal (`whatsapp_linked`).
**Texto sugerido** (lo ajusta el área legal de Forsa):

> {Compañía} usará tus datos de contacto, los gastos que registres y las fotos de tus facturas para
> gestionar tus anticipos y gastos de viaje. Las fotos se leen con un servicio de inteligencia
> artificial en el exterior que no guarda ni usa tus datos para entrenar. Puedes consultar,
> actualizar o pedir la supresión de tus datos escribiendo a {correo de Forsa}. Política completa:
> {enlace}.

## Transmisión internacional

- Los subencargados procesan los datos fuera de Colombia: no ofrecen almacenamiento en el país (ver
  `03_SUBPROCESADORES.md`).
- El Decreto 1377 de 2013 distingue dos casos:
  - **transferencia:** el receptor se vuelve responsable;
  - **transmisión:** el receptor trata los datos como encargado, por cuenta del responsable.
  - Este caso es una **transmisión**.
  - [Fuente: art. 3](https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=53646)
- Según los arts. 24 y 25 del mismo decreto, la transmisión internacional **no requiere informar al
  titular ni pedir su consentimiento** si existe un **contrato de transmisión**. Ese contrato debe
  fijar el alcance del tratamiento, las actividades del encargado y sus obligaciones.
  - Compilado en los arts. 2.2.2.25.5.1 y 2.2.2.25.5.2 del Decreto 1074 de 2015.
    [Fuente](https://cancilleria.gov.co/sites/default/files/Normograma/docs/pdf/decreto_1074_2015_pr026.pdf)
- **Medidas:**
  1. Contrato de transmisión entre Forsa y NextByte (borrador abajo).
  2. Términos de tratamiento de cada subencargado (enlaces en `03_SUBPROCESADORES.md`).
  3. El aviso de privacidad igual menciona el procesamiento en el exterior, por transparencia.
- Para referencia: el art. 26 de la Ley 1581 regula la **transferencia** a países sin un nivel
  adecuado de protección. [Fuente](http://www.secretariasenado.gov.co/senado/basedoc/ley_1581_2012.html)
  - La SIC publicó una lista de países adecuados (Circular 05 de 2017), que incluiría a Estados
    Unidos según su boletín.
    [Fuente](https://www.sic.gov.co/noticias-boletin-juridico-agosto-2017/circular-no-05-del-10-de-agosto-de-2017-publicada-en-el-diario-oficial-no-50321-del-10-de-agosto-de-2017)
  - La lista vigente hoy: **no verificado**.

## Conservación y supresión

- **Soportes contables, 10 años:** fotos de facturas, datos fiscales, líneas, decisiones y
  auditoría.
  - Código de Comercio, art. 60: "cuando menos por diez años".
    [Fuente](http://www.secretariasenado.gov.co/senado/basedoc/codigo_comercio_pr001.html)
  - Ley 962 de 2005, art. 28: diez años desde el último asiento, documento o comprobante, en papel
    o en un medio electrónico que garantice su reproducción exacta.
    [Fuente](http://www.secretariasenado.gov.co/senado/basedoc/ley_0962_2005.html)
  - Los plazos tributarios específicos los confirma contabilidad de Forsa (**no verificado**).
- **Supresión (derecho del titular):** aplica a los datos personales que **no** son soporte
  contable: celular, identificador y nombre de usuario de WhatsApp, nombre de perfil. Un
  administrador lo hace con `POST /employees/{id}/anonymize-contact` sobre un usuario ya
  desactivado: borra esos datos, deja los gastos intactos y queda en la auditoría (control D7).
- **Usuarios retirados:** se desactivan (pierden acceso al instante); su historial de gastos se
  conserva por la regla contable.

## Derechos del titular y cómo se atienden

| Derecho | Cómo se atiende hoy |
|---|---|
| Conocer y acceder | El empleado ve sus anticipos y gastos en la app y por WhatsApp. Forsa puede exportar su información |
| Actualizar y rectificar | El empleado corrige sus gastos; un administrador de Forsa actualiza sus datos de contacto |
| Suprimir | Ver "Conservación y supresión" |
| Revocar la autorización | Desactivación del usuario y desvinculación de su WhatsApp |
| Presentar quejas | Ante Forsa como responsable; NextByte apoya con la información que haga falta |

Plazos según la Ley 1581: **consultas**, 10 días hábiles (art. 14); **reclamos**, 15 días hábiles
(art. 15). NextByte entrega a Forsa la información que necesite **en máximo 5 días hábiles** desde
que la pide, para que Forsa pueda cumplir esos plazos.
[Fuente](http://www.secretariasenado.gov.co/senado/basedoc/ley_1581_2012.html)

## Borrador de contrato de transmisión de datos (para revisión legal)

Contenido mínimo propuesto, según el art. 25 del Decreto 1377 de 2013:

1. **Objeto y alcance:** NextByte trata los datos descritos en este documento solo para operar la
   plataforma de anticipos y gastos de viaje, según las instrucciones de Forsa.
2. **Obligaciones de NextByte:**
   - tratar los datos solo para las finalidades autorizadas;
   - aplicar los controles de `02_MATRIZ_DE_CONTROLES.md`;
   - guardar confidencialidad, y que la guarde también su personal;
   - no tratar los datos para fines propios;
   - apoyar a Forsa en la atención de consultas y reclamos.
3. **Subencargados:** la lista de `03_SUBPROCESADORES.md`. Se avisa con 30 días de anticipación
   antes de agregar o cambiar uno, y Forsa puede objetar.
4. **Incidentes:** NextByte avisa a Forsa según `05_RESPUESTA_A_INCIDENTES.md` (primer aviso en
   máximo 24 horas desde que confirma un incidente con datos personales).
5. **Auditoría:** Forsa puede pedir evidencia de los controles una vez al año, o tras un incidente.
6. **Terminación:** al terminar, NextByte entrega a Forsa los datos y archivos en formato estándar
   (base de datos y fotos) y los borra en máximo 30 días. Se exceptúa lo que la ley obligue a
   conservar, si Forsa no lo recibe.
7. **Ley aplicable:** la colombiana.
