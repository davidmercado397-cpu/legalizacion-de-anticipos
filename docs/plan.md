# Plan — Legalización de anticipos de viaje

## 1. Alcance

Aplicación responsive (PWA, luego React Native) para:

1. Proyectar un viaje con el presupuesto por **cargo × país × concepto × día/noche**.
2. Enviar la solicitud a **aprobación por niveles** (jefe inmediato y, si hay escalamiento, jefe directivo).
3. Al aprobarse, **crear el anticipo en Siesa Enterprise vía API** y registrar el desembolso.
4. Durante el viaje, **radicar soportes** (web, PWA o WhatsApp) con OCR, descripción y clasificación.
5. Aplicar **exclusiones** (licor, minibar…), detectar el **medio de pago** y **conciliar con el extracto** de la tarjeta débito corporativa.
6. Validar **CUFE (Colombia)** / **chave de acesso (Brasil)**, que la factura esté a nombre de la empresa, y manejar **recibos de caja con proveedor 222**.
7. **Evitar facturas duplicadas** en toda la organización.
8. Consolidar **una legalización por anticipo** y exportarla a Siesa.

## 2. Decisiones tomadas con el negocio

| # | Tema | Decisión | Impacto en el diseño |
|---|------|----------|----------------------|
| 1 | ERP | Siesa Enterprise, con API disponible. El anticipo se crea en Siesa **cuando la app envía la información** (al aprobarse la solicitud). | Puerto `ErpAnticiposGateway` + adaptador Siesa. Envío asíncrono con reintentos e idempotencia (outbox). |
| 2 | Monedas | El anticipo puede ser en **USD o COP**. | `Money` con moneda obligatoria; conversión con TRM guardada como *snapshot* en cada solicitud y legalización. |
| 3 | Tarjetas | Débito corporativas; **cualquier banco**. | Importador de extractos genérico: perfiles de mapeo de columnas (CSV/Excel) configurables por banco + extracción de PDF a tabla normalizada. |
| 4 | Facturas | **Todas** a nombre de la empresa colombiana (su NIT), en cualquier país. | Validación única: adquiriente = NIT de la empresa; si no, alerta para contabilidad. |
| 5 | Escalamiento | Dinámico. Ejemplo: tarifa de hotel 30 USD/noche y se proyectan 50 → **escala a jefe directivo**. | Reglas de escalamiento configurables (Specification + Factory), con tolerancia opcional. |
| 6 | Tope de recibos 222 | Configurable por contabilidad. | Parámetro administrable con historial de cambios. |
| 7 | Volumen | Máx. **1.500 facturas/mes** (~50/día). | Monolito modular; cola de trabajos sobre PostgreSQL (pg-boss), sin broker adicional. |
| 8 | Identidad | Usuarios locales; posibilidad futura de Microsoft 365. | Puerto de autenticación con adaptador local (JWT + argon2) y adaptador OIDC (Entra ID) posterior. |
| 9 | Lenguaje | **TypeScript** en todo el stack. | Monorepo pnpm; Zod compartido entre backend y frontend. |

## 3. Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node 22 + **NestJS** (solo como capa de presentación y composición), TypeScript |
| Persistencia | PostgreSQL + Drizzle ORM; almacenamiento de objetos (S3 / Azure Blob) para imágenes |
| Trabajos asíncronos | pg-boss (OCR, envío a Siesa, notificaciones) |
| Contratos | **Zod 4** en `packages/contracts`, usados por la API y los formularios |
| Frontend web | **React 19**, **TanStack Router**, **TanStack Query**, **Zustand**, **Axios**, **React Hook Form + Zod**, PWA |
| Móvil (futuro) | Expo + React Native + Expo Router, reutilizando los paquetes de cliente |
| Pruebas | Vitest, Testing Library, MSW, Playwright, pruebas de arquitectura |

## 4. Arquitectura

### 4.1 Monorepo

```
viaticos/
├─ apps/
│  ├─ api/                       NestJS (monolito modular)
│  │  └─ src/modules/<contexto>/
│  │       ├─ domain/            entidades, value objects, reglas, puertos de repositorio
│  │       ├─ application/       casos de uso + puertos (gateways externos)
│  │       ├─ infrastructure/    adaptadores: Drizzle, Siesa, OCR, WhatsApp, TRM
│  │       └─ presentation/      controladores HTTP, webhooks
│  ├─ web/                       React 19 (PWA)
│  └─ mobile/                    (futuro) Expo
└─ packages/
   ├─ shared-kernel/             Money, moneda, fechas, errores de dominio (front + back)
   ├─ contracts/                 esquemas Zod de la API (front + back)
   ├─ client-api/                axios + repositorios HTTP (web + RN)
   ├─ client-app/                queryOptions, mutations, stores Zustand, puertos de plataforma (web + RN)
   └─ i18n/                      es / pt / en
```

### 4.2 Regla de dependencia

`presentation → application → domain` e `infrastructure → application/domain`. El dominio **no** importa NestJS, Drizzle, axios ni nada de infraestructura. Una prueba de arquitectura (`apps/api/test/arquitectura.spec.ts`) falla si alguien rompe esta regla.

Los casos de uso son clases TypeScript puras, sin decoradores. NestJS solo las ensambla mediante *factory providers* en cada `*.module.ts`.

### 4.3 Bounded contexts

| Módulo | Responsabilidad | Estado |
|--------|-----------------|--------|
| `organizacion` | Usuarios, cargos, jefe inmediato y directivo | Iteración 1 (en memoria) |
| `tarifas` | Conceptos de viático (por día o noche) y tarifas por cargo × país con vigencia | Iteración 1 |
| `solicitudes` | Estimado, solicitud, ruta de aprobación, reglas de escalamiento | Iteración 1 |
| `comprobantes` | Ingesta, OCR, clasificación, exclusiones, **detección de duplicados** | Iteración 1 (duplicados) |
| `anticipos` | Anticipo, creación en Siesa, desembolso | Iteración 2 |
| `legalizaciones` | Una por anticipo; ítems, alertas, saldo, revisión contable | Iteración 3 |
| `conciliacion` | Perfiles de extracto, importación y cruce | Iteración 4 |
| `integracion-erp` | Capa anticorrupción para Siesa Enterprise | Iteraciones 2–3 |
| `whatsapp` | Webhook y flujo conversacional | Iteración 5 |

## 5. Reglas de negocio clave

### 5.1 Estimado

- Cada **concepto** tiene una unidad: `NOCHE` (alojamiento) o `DIA` (alimentación, transporte local…).
- Para un destino del 1 al 5: 5 días y 4 noches.
- Con varios destinos, el día de traslado compartido (A termina el 5 y B empieza el 5) se cuenta una sola vez para los conceptos diarios. Las noches no se solapan. Un solapamiento mayor es un error de validación.
- La tarifa aplicada es la vigente en la fecha de la solicitud y se guarda como *snapshot*.
- El viajero puede proponer otro valor unitario por concepto (ej. 50 USD/noche frente a 30). Si lo supera, la línea queda marcada como **excede tarifa**.
- El total se expresa en la moneda del anticipo (USD o COP) con la TRM del día, también guardada como *snapshot*.

### 5.2 Aprobaciones

- Siempre aprueba el **jefe inmediato**.
- Se agrega el **jefe directivo** cuando se activa una regla de escalamiento configurable:
  - `EXCEDE_TARIFA` (con tolerancia % opcional).
  - `MONTO_TOTAL_SUPERA` (umbral y moneda).
  - Se pueden agregar reglas nuevas sin tocar el núcleo.
- Si la solicitud escala, la **justificación es obligatoria**.
- Si jefe inmediato y directivo son la misma persona, aprueba una sola vez en el nivel directivo.
- Al completar la ruta se emite `SolicitudAprobada`, que dispara la creación del anticipo en Siesa (iteración 2).

### 5.3 Detección de duplicados

Ver [ADR-0007](adr/0007-deteccion-de-duplicados.md). Se aplica en varias capas y en varios momentos:

| Estrategia | Señal | Resultado |
|------------|-------|-----------|
| Archivo idéntico | SHA-256 de la imagen | **Duplicado** (bloquea) |
| Clave fiscal repetida | CUFE / CUDE / chave de acesso | **Duplicado** (bloquea) |
| Emisor + número | NIT o ID tributario normalizado + número de factura normalizado | **Duplicado** (bloquea) |
| Imagen similar | Hash perceptual (distancia de Hamming ≤ umbral) | Sospechoso (revisión) |
| Mismo emisor, fecha y total | Coincidencia aproximada | Sospechoso (revisión) |

**Momentos:**
1. Al recibir el archivo (hash), antes de pagar OCR.
2. Después del OCR.
3. Cada vez que el usuario corrige campos.
4. En la conciliación: un movimiento bancario solo puede cruzarse con un comprobante.

**Alcance:** toda la organización, no solo el viajero, porque dos personas pueden intentar legalizar la misma cena.

**Garantía final:** índices únicos parciales en PostgreSQL sobre clave fiscal, emisor + número y SHA-256, para comprobantes vigentes. Así se cubren carreras entre peticiones simultáneas.

### 5.4 Factura a nombre de la empresa, CUFE, Brasil, recibo 222

- El adquiriente debe ser el NIT de la empresa colombiana. Si no, el ítem se mantiene con la alerta `NO_A_NOMBRE_EMPRESA` para que contabilidad decida.
- Colombia: CUFE/CUDE (96 hex) del QR o el texto. Opcional: cruzar con el buzón de recepción de facturación electrónica.
- Brasil: chave de acesso de 44 dígitos (NF-e / NFC-e), con dígito verificador.
- Sin factura: recibo de caja con tercero **222 – Proveedores varios**, con el tope configurable por contabilidad.

## 6. Iteraciones

| Iteración | Entregable |
|-----------|-----------|
| **1 (en curso)** | Monorepo, shared-kernel, contratos, tarifas, estimado, solicitud con ruta de aprobación y escalamiento, motor de duplicados (dominio), API HTTP con repositorios en memoria, pruebas |
| 2 | PostgreSQL + Drizzle, autenticación local (JWT), anticipos + adaptador Siesa (crear anticipo), outbox, frontend web: estimado, solicitud y bandeja de aprobación |
| 3 | Comprobantes: carga, OCR, clasificación, exclusiones por línea, validación fiscal, legalización, revisión contable, recibo 222 |
| 4 | Conciliación con extractos (perfiles de mapeo), TRM automática |
| 5 | WhatsApp Business (radicación y notificaciones) |
| 6 | Microsoft 365 (OIDC), tableros, app móvil |

## 7. Pendientes por confirmar

- Documentación de la API de Siesa Enterprise: endpoints para crear el anticipo y la legalización, tercero, centro de costo, conceptos.
- Matriz real de tarifas y lista de conceptos.
- Lista inicial de exclusiones.
- Ejemplos reales de facturas (Colombia, Brasil, otros) y de extractos, para el set de pruebas de OCR.
