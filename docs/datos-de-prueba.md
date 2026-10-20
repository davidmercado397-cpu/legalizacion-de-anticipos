# Datos de prueba: presupuesto por país y legalización

Al arrancar con Docker (`docker compose up --build --watch`) la API crea estos datos sola. Si su base viene de una versión anterior, al reiniciar se agregan las zonas, las tarifas y los usuarios que falten, sin borrar nada. Contraseña de todos: **`Viaticos2026*`**.

## Quién es quién

| Usuario | Rol | Tipo de personal |
|---|---|---|
| `ana@empresa.co` | Empleada (jefe: Carlos) | Administrativo |
| `oscar@empresa.co` | Empleado (jefe: Carlos) | Operativo |
| `carlos@empresa.co` | Aprueba a Ana y a Óscar | Administrativo |
| `diana@empresa.co` | Jefa de Carlos (aprueba lo que escala) | Administrativo |
| `laura@empresa.co` | Contabilidad | — |
| `tomas@empresa.co` | Tesorería | — |

El tipo de personal decide qué tarifa aplica: el mismo viaje cuesta distinto para Ana y para Óscar.

## Zonas y tarifas cargadas

Vigentes desde el 1 de enero de 2026. Se ven y se cambian en *Contabilidad → Tarifas de viaje* (entrando como Laura).

| Zona | Lugares | Moneda | Hospedaje (noche) | Alimentación (día) | Transporte (día) | Impuesto aeroportuario (viaje) |
|---|---|---|---|---|---|---|
| Ciudades principales | Bogotá, Medellín, Cali, Barranquilla, Cartagena | COP | 280.000 / 220.000 | 110.000 / 85.000 | 60.000 / 45.000 | — |
| Resto de Colombia | Pasto, Manizales, Pereira, Bucaramanga, Santa Marta, Colombia | COP | 200.000 / 160.000 | 85.000 / 70.000 | 45.000 / 35.000 | — |
| Estados Unidos | Miami, Nueva York, Houston, Orlando, Estados Unidos | USD | 180 / 150 | 75 / 60 | 40 / 30 | 50 |
| Brasil | São Paulo, Rio de Janeiro, Brasilia, Brasil | BRL | 750 / 600 | 300 / 250 | 150 / 125 | 200 |
| México | Ciudad de México, Monterrey, Guadalajara, Cancún, México | MXN | 2.700 / 2.100 | 1.100 / 900 | 550 / 450 | — |
| Panamá | Ciudad de Panamá, Colón, Panamá | USD | 140 / 110 | 55 / 45 | 30 / 25 | — |

*Administrativo / operativo.* En el destino escriba **solo la ciudad** (p. ej. «Medellín», no «Medellín, Colombia»): el sistema busca la ciudad entre los lugares de cada zona.

## Cómo se calcula

- Un viaje del 3 al 5 son **3 días y 2 noches**: alimentación y transporte por día, hospedaje por noche, el impuesto aeroportuario una vez por destino.
- **Varios destinos:** el día en que cambia de ciudad se paga una sola vez, con la tarifa de la ciudad a la que llega.
- **Moneda:** el anticipo se calcula en la de las tarifas del destino (BRL en Brasil, MXN en México, USD en Estados Unidos). Si el viaje mezcla monedas, va en **USD**. Pero la empresa lo **entrega y lo legaliza en pesos** (la moneda de la compañía): al pedirlo se estima en pesos con la tasa del día, y al desembolsar tesorería fija lo que entregó. Las tasas las descarga la API sola; sin internet hay que escribir el valor a mano.
- El valor sugerido no es un tope: pedir otro valor exige justificarlo, y si supera en más del 10 % el calculado también lo aprueba el jefe directivo (Diana).

## Casos para probar (valores esperados)

| # | Quién | Viaje | Presupuesto |
|---|---|---|---|
| 1 | Ana | Medellín, 3 al 5 de noviembre | **$1.070.000 COP** (2 noches × 280.000 + 3 días × 110.000 + 3 × 60.000) |
| 2 | Óscar | Medellín, 3 al 5 de noviembre | **$830.000 COP** (tarifa operativa) |
| 3 | Ana | Pasto, 10 al 11 de noviembre | **$460.000 COP** (resto de Colombia) |
| 4 | Ana | Miami, 16 al 19 de noviembre | **USD 1.050** (3 noches × 180 + 4 días × 75 + 4 × 40 + 50) |
| 5 | Ana | Ciudad de Panamá, 23 al 25 de noviembre | **USD 535** |
| 6 | Ana | Cali del 7 al 9 de diciembre y Cartagena del 9 al 11 | **$1.970.000 COP** (el 9 lo paga Cartagena) |
| 7 | Ana | Bogotá del 1 al 2 de diciembre y São Paulo del 2 al 5 | **En USD** (mezcla pesos y reales; depende de las tasas del día) |
| 8 | Ana | São Paulo, 10 al 12 de noviembre | **BRL 3.050** (2 noches × 750 + 3 días × 300 + 3 × 150 + 200); se entrega en pesos |
| 9 | Ana | Ciudad de México, 17 al 19 de noviembre | **MXN 10.350** (2 noches × 2.700 + 3 días × 1.100 + 3 × 550); se entrega en pesos |

Para el 6 y el 7 use **«Agregar otro destino»** en la solicitud.

## Recorrido sugerido

1. **Solicitar** (Ana): *Mis anticipos → Solicitar anticipo*. Escriba el destino y las fechas, pulse **Calcular con las tarifas** y envíe. Pruebe también a pedir más (p. ej. $1.300.000 en el caso 1): le pide justificación y la solicitud escala a Diana.
2. **Aprobar** (Carlos): *Aprobaciones*. Si escaló, Diana puede aprobar sin esperar a Carlos.
3. **Entregar** (Tomás, opcional): *Tesorería → Registrar desembolso*.
4. **Legalizar** (Ana): abra el anticipo y suba fotos de facturas (cualquier imagen o PDF sirve). Sin la clave de IA, los datos se escriben a mano; luego **Está bien: confirmar**. Para ver las reglas en acción:
   - una factura con fecha **fuera del viaje** (p. ej. dos días después del regreso) queda para que la revise contabilidad;
   - un **recibo de caja** sin marcar «firmado por quien me vendió» pide justificación;
   - una **propina** mayor al 10 % del consumo se marca, y el exceso se sugiere como no reembolsable;
   - una factura en **otra moneda** (p. ej. USD en un anticipo en pesos) se convierte con la tasa del día de la factura.

   Al terminar, **Enviar legalización a revisión**.
5. **Revisar y cerrar** (Laura): *Contabilidad → Legalizaciones por revisar*. Decida los gastos con hallazgos y pulse **Aprobar legalización**. Luego puede probar **Crear legalización en Siesa**: queda pendiente porque Siesa aún no está conectado.
6. **Liquidar** (Tomás): si sobró dinero, registre el reintegro; si Ana gastó de más, el reembolso.
7. **Ver los números** (Laura): *Contabilidad → Reportes*.

Para empezar de cero: `docker compose down -v` y vuelva a arrancar.

## Retiros en el exterior (casos 8 y 9)

1. **Desembolso** (Tomás): el formulario propone los pesos con la tasa de hoy; si entregó otro valor, escríbalo.
2. **Retiro** (Ana): en el anticipo, *Retiros en efectivo → Registrar retiro*: fecha, moneda (BRL), valor (p. ej. 500). Si sabe lo que le debitó el banco en pesos, escríbalo; si no, se usa la tasa oficial del día.
3. **Facturas en efectivo** (Ana): con medio de pago *Efectivo* (o «Según el anticipo» si es en efectivo) y en BRL, cada una sale del retiro más antiguo que tenga saldo, con su tasa. Una factura puede salir de dos retiros. Si ningún retiro la cubre (p. ej. es de antes del retiro), va con la tasa del día de la factura y queda para que la revise contabilidad.
4. **Lo debitado y la comisión** (Tomás, días después, con el extracto): en el retiro, *Registrar lo debitado y la comisión*. Las facturas se recalculan solas y la comisión suma como un gasto en pesos.
