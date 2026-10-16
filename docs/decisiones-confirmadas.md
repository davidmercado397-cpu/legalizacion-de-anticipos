# Decisiones confirmadas por el negocio

Respuestas al documento «Decisiones por confirmar» (16 de octubre de 2026). Cada fila dice qué se decidió y cómo queda en el sistema.

## 1. Tasas de cambio

| # | Decisión | En el sistema |
|---|----------|---------------|
| 1.1 | TRM certificada por la Superintendencia Financiera | `FuenteTrmDatosGov` (ADR-0008) |
| 1.2 | Todo se calcula vía dólar | Tasas cruzadas vía USD |
| 1.3 | Se viaja a Brasil y Estados Unidos | BRL por el BCE; USD directo |
| 1.4 | Presupuesto con la TRM del día del cálculo | Sin cambios |
| 1.5 | Cada factura con la tasa del día de la factura | Sin cambios |
| 1.6 | Fines de semana y festivos: la TRM vigente ese día | Sin cambios |
| 1.7 | Respaldo de hasta 5 días si la fuente no responde | Sin cambios |
| 1.8 | Pagos con tarjeta: valor cobrado por el banco | Al conciliar, el soporte se legaliza por el valor del extracto (ver 7.8) |

## 2. Fechas

| # | Decisión | En el sistema |
|---|----------|---------------|
| 2.1 | Facturas desde el día de salida hasta 1 día después del regreso | Fuera de ese rango: alerta que contabilidad decide |
| 2.2 | Facturas con fecha futura se rechazan | Sin cambios |
| 2.3 | El día de regreso se paga completo, sin hotel | Sin cambios (días = noches + 1) |
| 2.4 | El día de traslado se paga con la tarifa de la ciudad de llegada | Cambia `calcularUnidades` |
| 2.5 | Plazo para legalizar: 1 mes después del regreso | Fecha límite visible y alerta de vencida |

## 3. Exclusiones

| # | Decisión | En el sistema |
|---|----------|---------------|
| 3.0 | Excluir cualquier licor; minibar y tabaco como están | Lista de licores ampliada |
| 3.1 | Lavandería sí; películas, cine y spa no | Nuevas exclusiones: entretenimiento y spa |
| 3.2 | Valor aceptado = total menos líneas excluidas | Sin cambios |
| 3.3 | Propinas aceptadas hasta la sugerida en la factura | El exceso sobre la propina sugerida se excluye |
| 3.4 | El impuesto de una línea excluida también se excluye | Se excluye la parte proporcional del impuesto |
| 3.5 | Palabras ambiguas: alerta para verificación humana | Línea «por verificar»; contabilidad decide |

## 4. Presupuesto y aprobaciones

| # | Decisión | En el sistema |
|---|----------|---------------|
| 4.1 | Tolerancia 10 %, configurable por contabilidad | Pantalla de configuración |
| 4.2 | Umbral por monto total configurable por contabilidad | Pantalla de configuración |
| 4.3 | Justificación obligatoria al escalar | Sin cambios |
| 4.4 | El directivo puede aprobar sin esperar al jefe inmediato | Su aprobación completa la ruta |
| 4.5 | Los viajes de directivos los aprueba la gerencia | Rol `GERENCIA` |
| 4.6 | Conceptos y tarifas administrables desde la aplicación | CRUD de conceptos y tarifas |
| 4.7 | Los tiquetes aéreos no hacen parte del anticipo | Sin cambios |
| 4.8 | La moneda del anticipo depende del país de destino | Moneda de la tarifa del país; destinos mixtos → USD |

## 5. Facturas y recibos 222

| # | Decisión | En el sistema |
|---|----------|---------------|
| 5.1 | NIT configurable; holding con varias empresas | Empresas administrables; cada empleado pertenece a una |
| 5.2 | Factura a nombre de otro: contabilidad decide | Sin cambios |
| 5.3 | Sin CUFE / chave de acesso: exige decisión de contabilidad | Alerta de revisión |
| 5.4 | Suma de líneas distinta del total: informativa | Sin cambios |
| 5.5 | Tope del recibo 222 configurable por contabilidad | Sin cambios |
| 5.6 | Foto del recibo 222 obligatoria y firmada | Foto obligatoria y declaración de firma |
| 5.7 | Se aceptan tiquetes POS para todos | Sin cambios |

## 6. Duplicados

| # | Decisión | En el sistema |
|---|----------|---------------|
| 6.1 | Notificar que está duplicada y no repetirla | Sin cambios |
| 6.2 | La legaliza quien pagó; a futuro, opción de dividir la cuenta | Pendiente: cuenta dividida |
| 6.3 | Sin cambios en las señales | Sin cambios |

## 7. Conciliación bancaria

| # | Decisión | En el sistema |
|---|----------|---------------|
| 7.1 | Tesorería carga el extracto después de la legalización | Rol `TESORERIA` carga, con la legalización enviada |
| 7.2 | Se acepta lo cobrado por el banco | Ver 7.8 |
| 7.3 | Mismo día, máximo 1 día de diferencia | `diasMaximos = 1` |
| 7.4 | Ponderación propuesta aceptada | Sin cambios |
| 7.5 | Se acepta la diferencia (p. ej. propina en el datáfono) | Ver 7.8 |
| 7.6 | Cargos sin factura: contabilidad decide si se descuentan | Decisión por cargo; suma al saldo del viajero |
| 7.7 | Factura con tarjeta sin cargo: alerta a contabilidad | Alerta de revisión en el soporte |
| 7.8 | Se legaliza el valor cobrado en el extracto | Valor del extracto reemplaza el de la factura |
| 7.9 | Se aceptan extractos en PDF | Lectura del PDF con IA |

## 8. Siesa, desembolso, IA y usuarios

| # | Decisión | En el sistema |
|---|----------|---------------|
| 8.1 | El anticipo se crea en Siesa al aprobarse la solicitud. La legalización se envía cuando contabilidad termina y pulsa «Crear legalización en Siesa» | Botón y estado nuevo |
| 8.2 | Un documento por legalización | Sin cambios |
| 8.3 | Tesorería registra el desembolso | Sin cambios |
| 8.4 | Saldo a favor de la empresa: consignación registrada por tesorería | Registro de reintegro |
| 8.5 | Saldo a favor del viajero: siempre se reembolsa | Registro de reembolso por tesorería |
| 8.6 | Lectura con IA activa; proveedor configurable, no solo Anthropic | El administrador elige proveedor y modelo; claves cifradas |
| 8.7 | Sesión de 7 días aceptada | Sin cambios |
| 8.8 | Usuarios gestionados por un administrador | Rol `ADMIN` y pantalla de usuarios |
| 8.9 | La traducción es de las facturas, no de la aplicación | La IA traduce las líneas al español |
