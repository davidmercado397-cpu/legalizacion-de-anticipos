# ADR-0008: Tasas de cambio oficiales del día

- Estado: Aceptada

## Contexto
El negocio pide que la TRM sea **la del día** y que se ajuste sola todos los días. Los anticipos son en USD o COP, pero las facturas llegan en la moneda de cada país (BRL, EUR, MXN, PEN…).

## Decisión
Módulo `tasas`, que provee el puerto `ProveedorTasaCambio` a toda la aplicación:

1. **COP:** TRM certificada por la Superintendencia Financiera, publicada en datos.gov.co (dataset `32sa-8pi3`). Se usa el registro vigente en la fecha (los fines de semana y festivos tienen vigencia propia).
2. **Otras monedas:** Banco Central Europeo vía Frankfurter (día hábil anterior si la fecha no tiene dato). Las tasas cruzadas (BRL→COP) se calculan vía USD.
3. **Monedas sin fuente automática** (PEN, CLP, ARS…): tasas configuradas (`TASAS_RESPALDO`), marcadas como `CONFIGURADA`.
4. **Qué fecha se usa:** el estimado de un viaje usa la TRM de hoy (aunque el viaje sea futuro). Cada factura se convierte con la tasa de su fecha de emisión.
5. **Actualización:** una tarea consulta cada hora las tasas de hoy. Una cotización solo se guarda en `cotizaciones_dolar` cuando es definitiva (fecha pasada, o la de hoy ya publicada). Mientras tanto se usa la última publicada y se vuelve a consultar, así el cambio de día se refleja solo.
6. Si la fuente no responde, se usa la última tasa guardada de hasta 5 días antes, marcada "(última disponible)". Si no hay ninguna, la operación responde `TASA_NO_DISPONIBLE` (422): no se inventa una tasa.
7. `TASAS_PROVEEDOR=fija` (TRM_DESARROLLO) solo para trabajar sin internet y para pruebas; está prohibido en producción.

## Consecuencias
- Cada solicitud y soporte guarda la tasa usada con su fuente y fecha (ej. `TRM 2026-10-16`), para auditoría.
- Cambiar de fuente (por ejemplo, el Banco de la República o la tasa de Siesa) es agregar un adaptador `FuenteTasas`.
