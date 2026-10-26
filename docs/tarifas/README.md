# Tarifas de viaje de Forsa

Tabla de viáticos que entregó Forsa, lista para cargar. Son datos de negocio, no van en el código:
se cargan por API en cada compañía del grupo que las use.

- Alimentación y refrescos van juntos en la categoría `meals` ("Alimentación y refrescos").
- Lavandería, transporte local e internet van separados.
- Internet es un plan por cada 15 días de viaje: de 1 a 15 días es 1 plan, de 16 a 30 son 2.
- Las tarifas son iguales para el personal administrativo y el operativo.
- Rigen desde el 2026-11-01. Si cambian, se carga un Excel nuevo con otra fecha `desde`; para cada
  categoría manda la tarifa más reciente.

| Zona | Hospedaje / noche | Alimentación y refrescos / día | Lavandería / día | Transporte local / día | Internet / 15 días | Moneda |
|---|---|---|---|---|---|---|
| Colombia | 137.500 | 76.000 | 9.000 | 43.600 | — | COP |
| Brasil | 363 | 158 | 35 | 218 | 80 | BRL |
| México | 2.090 | 880 | 220 | 436 | 300 | MXN |
| Estados Unidos | 130 | 58 | 9 | 38 | 15 | USD |
| Destino Latinoamérica | 88 | 58 | 7 | 38 | 15 | USD |
| Medio Oriente/África/Caribe | 145 | 63 | 9 | 42 | 15 | USD |
| Otros destinos | 121 | 58 | 9 | 38 | 15 | USD |

Ejemplo: un viaje de 3 días a Brasil da 2 noches × 363, más 3 días × (158 + 35 + 218), más 1 plan
de internet de 80. En total son BRL 2.039.

## Cómo cargarlas

Lo hace contabilidad (o un administrador) en **Administración → Tarifas**, en cada compañía que las use:

1. **Zonas:** crear las 7 zonas con los nombres y lugares de [`zonas.json`](zonas.json) (o por la API,
   `POST /api/v1/companies/{company_id}/travel-zones` con cada objeto del archivo). El nombre debe ser igual
   al de la columna `zona` del Excel.
2. **Tarifas:** «Importar Excel» con [`forsa_tarifas_viaje.xlsx`](forsa_tarifas_viaje.xlsx) (o
   `POST /api/v1/companies/{company_id}/travel-rates/import`). Todo o nada: si una fila tiene un error, se dice
   cuál y no se guarda ninguna.

Los lugares resuelven el destino escrito ("Visita a obra en São Paulo" cae en Brasil): sin tildes ni
mayúsculas, y si coinciden varias zonas gana el lugar más largo. Si el destino no coincide con ninguno, se
elige la zona ("Otros destinos" cubre lo que no está en la lista). Se dejaron por fuera nombres repetidos entre
países (Santiago, San José, San Juan, La Paz).

El anticipo se calcula en la moneda de la zona (decisión 4.8; si el viaje mezcla zonas en distintas monedas,
en dólares). Si la compañía trabaja en esa moneda (sus monedas en Administración → Compañías), se entrega y se
legaliza en ella; si no, en la moneda local de la compañía (decisión 9.2). Si Forsa quiere otra tabla para otra
compañía del grupo, se carga un Excel distinto en esa compañía.
