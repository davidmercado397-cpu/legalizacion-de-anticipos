# ADR-0009: Conciliación con el extracto de la tarjeta

- Estado: Aceptada (parámetros por confirmar con contabilidad)

## Contexto
Las tarjetas son débito corporativas de **cualquier banco**. Cada banco exporta su extracto con columnas, formatos de fecha y de número distintos. Hay que verificar que cada pago con tarjeta legalizado aparezca en el extracto, y detectar cargos que nadie legalizó.

## Decisión
Módulo `conciliacion`:

1. **Lectura genérica.** Se aceptan CSV/TXT (separador y codificación detectados: UTF-8 o Windows-1252) y Excel `.xlsx`. Un **perfil de extracto** dice qué columna es la fecha, la descripción y el valor (una columna con signo, o débito y crédito), y cómo vienen fechas y decimales. El sistema sugiere el perfil leyendo los títulos (es/pt/en) y una muestra; la persona lo revisa con una vista previa. Contabilidad puede guardarlo con un nombre para reutilizarlo.
2. **Quién carga.** El viajero o contabilidad, desde la legalización. El extracto queda asociado al titular (el viajero) y se cruza con **todas** sus facturas con tarjeta del periodo, aunque sean de otras legalizaciones.
3. **Cruce uno a uno** (dominio puro, `conciliar`). Para cada par cargo–factura:
   - Se descarta si los últimos 4 dígitos no coinciden, si hay más de 5 días de diferencia o si el valor difiere más que la tolerancia (1 % en la misma moneda, 6 % si hubo conversión).
   - Puntaje = 0,5 × valor + 0,3 × fecha + 0,2 × parecido del comercio. Con 0,80 o más queda conciliado automáticamente; entre 0,55 y 0,80 queda “por revisar”.
   - Los pares se asignan de mayor a menor puntaje; cada cargo y cada factura se usan una sola vez.
4. **Decisiones de contabilidad.** Confirmar, “no corresponde” (el par no se vuelve a proponer) o enlazar a mano. “Volver a cruzar” respeta lo confirmado o enlazado.
5. **Reporte.** Cargos sin factura (con su total) y facturas con tarjeta sin cargo en el extracto.
6. **Integridad.** Un mismo archivo no se carga dos veces (SHA-256) y una factura no se cruza en dos extractos (índice único).

## Consecuencias
- Por ahora la conciliación es informativa: no bloquea la aprobación de la legalización.
- El valor del extracto no reemplaza el de la factura.
- Los extractos en PDF quedan para una iteración posterior (lectura con IA).
