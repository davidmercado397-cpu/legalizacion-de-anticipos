# 3. Subprocesadores

Terceros que reciben datos de la plataforma. Todo lo que se afirma aquí sale de páginas oficiales de
cada proveedor, consultadas el **16/10/2026** (enlace en cada fila). Lo que no se pudo confirmar en
una fuente oficial está marcado como **no verificado**. Esta información debe revisarse cada año o
cuando un proveedor cambie sus términos.

En términos de la Ley 1581, Forsa es el **Responsable** del tratamiento, NextByte es **Encargado** y
estos proveedores son subencargados (ver `04_PROTECCION_DE_DATOS.md`).

## Resumen

| Proveedor | Para qué | Datos que recibe | Certificaciones (fuente oficial) |
|---|---|---|---|
| Meta (WhatsApp Cloud API) | Canal de mensajería con los técnicos | Teléfono o identificador de WhatsApp, nombre de perfil, mensajes y fotos que el técnico envía, y las respuestas del bot | SOC 2 Type II e ISO 27001 |
| Cloudflare (R2) | Archivo de las fotos y PDF de las facturas | Las fotos y PDF originales | ISO 27001:2022, ISO 27018, ISO 27701, SOC 2 Type II (R2 dentro del alcance) |
| OpenRouter | Pasarela hacia el modelo de IA | Imagen de la factura (redimensionada) y contexto de la compañía (nombre, país, moneda, conceptos bloqueados) | SOC 2 Type 2 |
| Google (Gemini, en Vertex AI) | Modelo de IA principal | Lo mismo que OpenRouter, reenviado por este | Google Cloud: ISO 27001, 27017, 27018, SOC 2 e ISO 42001; la IA generativa de Vertex está dentro del alcance |
| Anthropic (Claude Haiku) | Modelo de respaldo si Gemini no está disponible | Lo mismo, solo en ese caso | ISO 27001:2022, ISO/IEC 42001:2023, SOC 2 Type I y II |
| Hosting (VPS con Coolify) | API, PostgreSQL y Redis | Todos los datos de la plataforma | **Por definir con el proveedor elegido** (ver al final) |

**La IA no recibe nombres, correos, teléfonos ni cédulas de los empleados.** Una factura puede
traer datos de terceros, como el nombre o el NIT de un proveedor que es persona natural, o el
nombre del cliente si se imprimió. Por eso se exige no entrenamiento y retención cero.

## Meta: WhatsApp Cloud API

- **Seguridad:** "We have obtained SOC 2 Type II and ISO 27001 reports". Los mensajes de la Cloud API
  se cifran en reposo.
  [Fuente](https://developers.facebook.com/documentation/business-messaging/whatsapp/data-privacy-and-security)
- **Retención:** los mensajes se guardan como máximo 30 días.
  [Fuente](https://developers.facebook.com/documentation/business-messaging/whatsapp/data-privacy-and-security)
  - La media dura 30 días, salvo que se borre antes; las URL de descarga caducan a los 5 minutos.
    [Fuente](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)
  - Por eso la plataforma copia cada foto a R2 apenas llega.
- **Uso de los datos:** Meta declara que la Cloud API no usa automáticamente los mensajes para
  publicidad. Sobre el uso para entrenar IA, la página no dice nada: **no verificado**.
- **Ubicación:** el procesamiento ocurre en centros de datos de Meta.
  - Existe almacenamiento local opcional por región, pero **Colombia no está entre las regiones**.
    [Fuente](https://developers.facebook.com/documentation/business-messaging/whatsapp/local-storage/)
- **Términos de tratamiento:** WhatsApp Business Data Processing Terms, actualizados el
  22/08/2025. [Fuente](https://www.whatsapp.com/legal/business-data-processing-terms)

## Cloudflare: R2

- **Certificaciones:**
  - ISO 27001 (versión 2022), ISO 27018:2019 e ISO 27701:2019, con alcance "Cloudflare global
    cloud platform and subsidiary offices".
    [Fuente](https://www.cloudflare.com/trust-hub/compliance-resources/iso-certifications/)
  - SOC 2 Type II (seguridad, confidencialidad y disponibilidad), con **R2 dentro del alcance**. El
    informe se entrega bajo acuerdo de confidencialidad.
    [Fuente](https://www.cloudflare.com/trust-hub/compliance-resources/soc-2/)
- **Cifrado en reposo:** siempre activo. Cada objeto y sus metadatos se cifran con AES-256-GCM, sin
  configuración. [Fuente](https://developers.cloudflare.com/r2/reference/data-security/)
- **Ubicación:**
  - La región que se elige (por ejemplo, Norteamérica) es una preferencia, no una garantía.
  - Solo la jurisdicción UE o FedRAMP garantiza la ubicación. **No hay opción Colombia ni
    Latinoamérica.** [Fuente](https://developers.cloudflare.com/r2/reference/data-location/)
- **Retención:** la decide la plataforma. Las fotos son soporte contable y se guardan 10 años (ver
  `04_PROTECCION_DE_DATOS.md`).
- **Términos de tratamiento:** Cloudflare Data Processing Addendum v6.4, vigente desde el
  03/04/2026. [Fuente](https://www.cloudflare.com/cloudflare-customer-dpa/)
- **Configuración aplicada:**
  - bucket privado, sin acceso público;
  - llaves de API con permiso solo sobre ese bucket;
  - enlaces firmados de 5 minutos.

## OpenRouter

- **Certificación:** SOC 2 Type 2, con informe descargable en su centro de confianza. No declara
  ISO 27001. [Fuente](https://trust.openrouter.ai/)
- **Retención:** "OpenRouter does not store your prompts or responses, unless you opt in". Sí guarda
  metadatos de cada petición, como tokens y latencia.
  [Fuente](https://openrouter.ai/docs/guides/privacy/data-collection)
- **Configuración aplicada en cada petición** (`app/adapters/outbound/openrouter.py`):
  - `data_collection: "deny"`: solo se usan proveedores que no recolectan datos.
    [Fuente](https://openrouter.ai/docs/features/provider-routing)
  - `zdr: true` (retención cero, activo por defecto; llave `ai.zero_data_retention`): solo se
    enruta a endpoints con política de retención cero. Un endpoint sin política clara se trata como
    si retuviera datos y queda excluido. [Fuente](https://openrouter.ai/docs/features/zdr)
  - Comprobado el 16/10/2026 con la lista pública de endpoints de retención cero de OpenRouter: los
    tres modelos configurados tienen endpoints que la cumplen.
    - Gemini 3.8 Flash y 3.5 Flash-Lite, en Google Vertex.
    - Claude Haiku 5.5, en Google Vertex y Amazon Bedrock.
    - [Fuente](https://openrouter.ai/api/v1/endpoints/zdr)
- **Configuración de la cuenta** (lista de verificación al desplegar):
  - mantener **desactivada** la opción de "mejora de producto", que permite a OpenRouter guardar
    entradas a cambio de un descuento;
  - límite de gasto en la llave de API.
- **Ubicación:** solo los planes Business o Enterprise permiten fijar la región (UE o EE. UU.). La
  ubicación por defecto: **no verificado**.
  [Fuente](https://openrouter.ai/docs/guides/features/sovereign-ai)
- **Términos de tratamiento:** incorporados a sus Términos (sección 10.2).
  [Fuente](https://openrouter.ai/terms); el texto del acuerdo está en
  [este enlace](https://openrouter.ai/data-processing-agreement) (contenido **no verificado**).

## Google: Gemini, vía Vertex AI

OpenRouter puede enrutar Gemini a dos servicios de Google con políticas distintas:

| Servicio | Retiene las peticiones | Entrena con ellas | Fuente |
|---|---|---|---|
| Google Vertex AI | No | No | [OpenRouter: Vertex](https://openrouter.ai/provider/google-vertex) |
| Google AI Studio | Sí, 55 días | No | [OpenRouter: AI Studio](https://openrouter.ai/provider/google-ai-studio) |

- Con la retención cero activa, **AI Studio queda excluido** y las facturas solo van a Vertex.
- **Vertex:** "Google won't use your data to train or fine-tune any AI/ML models without your prior
  permission". La caché se borra a más tardar a las 24 horas.
  [Fuente](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
- **Certificaciones de Google Cloud:** la IA generativa de Vertex (hoy "Gemini Enterprise Agent
  Platform") está en el alcance de las siguientes certificaciones.
  - ISO 27001 — [Fuente](https://cloud.google.com/security/compliance/iso-27001)
  - ISO 27017 — [Fuente](https://cloud.google.com/security/compliance/iso-27017)
  - ISO 27018 — [Fuente](https://cloud.google.com/security/compliance/iso-27018)
  - SOC 2 — [Fuente](https://cloud.google.com/security/compliance/soc-2)
  - Google Cloud además declara ISO/IEC 42001:2023 (gestión de IA).
    [Fuente](https://cloud.google.com/security/compliance/iso-42001)

## Anthropic: Claude Haiku (solo respaldo)

- Se usa únicamente si Gemini no está disponible en ese momento.
- **Certificaciones:** ISO 27001:2022, ISO/IEC 42001:2023, SOC 2 Type I y Type II.
  [Fuente](https://support.claude.com/en/articles/10015870-what-certifications-has-anthropic-obtained)
- **Entrenamiento:** "Anthropic may not train models on Customer Content from Services".
  [Fuente](https://www.anthropic.com/legal/commercial-terms)
- **Retención:** con la retención cero activa, OpenRouter enruta Haiku a Google Vertex o Amazon
  Bedrock, y no a la API directa de Anthropic. Para la API directa, OpenRouter muestra una retención
  de 30 días. [Fuente](https://openrouter.ai/provider/anthropic)

## Hosting

El servidor (VPS administrado con Coolify) aloja la API, PostgreSQL y Redis. **El proveedor y la
región se confirman con Forsa antes del piloto.**

Antes de elegirlo hay que comprobar:

- certificación ISO 27001 o SOC 2 del centro de datos;
- cifrado de disco;
- región;
- acuerdo de tratamiento de datos.

Mientras no se defina, el cifrado en reposo de la base de datos aparece como **parcial** en la
matriz (control D4).

## Fuentes públicas de tasas de cambio (no reciben datos)

La plataforma consulta la TRM oficial en datos.gov.co y las tasas de referencia del BCE en
Frankfurter (`api.frankfurter.dev`). Son consultas de lectura sin credenciales: no se les envía
ningún dato de Forsa ni de sus empleados, así que no son subprocesadores.

## Cambios de subprocesadores

Compromiso propuesto (va en el contrato de transmisión, ver `04_PROTECCION_DE_DATOS.md`):
NextByte avisa a Forsa por escrito, con al menos 30 días de anticipación, antes de agregar o
cambiar un subprocesador que reciba datos personales. Forsa puede objetar el cambio.
