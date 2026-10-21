# Sistema de diseño de la web (nextv.ia)

Cómo se ve y se comporta la app web. Lo sigue cualquier persona (o IA) que toque `apps/web`. Recoge las
reglas de [impeccable](https://github.com/pbakaus/impeccable) y
[ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) que aplican a esta app; no se
instalan.

**Dirección: "B+"** (elegida sobre la vista previa del 21/10/2026): limpia y con aire, barra lateral clara,
tipografía fuerte en navy y pocas cajas. De la dirección densa se tomaron la búsqueda global, las cifras con
contexto, los íconos por motivo y los botones reales en cada acción.

## Marca y color

Los tokens viven en `src/styles.css` (`@theme`). Nunca un hex suelto en un componente.

| Token | Uso |
|---|---|
| `navy-950` `#0B1020` | Texto principal (es `slate-900`), botón primario, avatar |
| `navy-900/800/700` | Hover del botón primario y superficies oscuras puntuales |
| `marca-700` `#3A5FE0` | Enlaces, selección actual, foco. Es el único azul que va como texto |
| `marca-600` | Barras y anillo de foco, nunca texto |
| `marca-50/100/200` | Fondos suaves de selección o información |
| `destello` `#7FA0FF` | Acento en gráficos y la estrella del logo; nunca texto sobre blanco |
| `slate-*` | Neutros teñidos de navy. `100` fondo de la barra lateral, `200` líneas, `400`+ texto secundario |
| emerald / amber / red | Estados: hecho, atención, error. Siempre con texto o ícono, nunca solo color |

- El acento azul es para acciones secundarias, enlaces y selección; la acción principal de cada pantalla es
  navy. Una sola acción principal por pantalla.
- Fondo de la app blanco; la barra lateral `slate-100` con borde `slate-200`.
- Contraste mínimo 4,5:1 para texto (3:1 para texto de 24 px o más e íconos). `slate-400` es el más claro
  permitido para texto.

## Tipografía

- Una sola familia: **Plus Jakarta Sans** (variable, alojada con `@fontsource-variable`, sin Google).
- Escala fija: 12 · 14 · 16 · 18 · 24 · 34 px. Título de página 34/800 con `tracking-tight`; sección 18/700;
  cuerpo 14–15/400–500; etiquetas 12–13/600.
- Cifras y montos con `tabular-nums` para que alineen en tablas y totales.
- Líneas de lectura de 65–75 caracteres; las tablas pueden ser más anchas.
- Más espacio arriba de un título que debajo.

## Disposición

- Barra lateral clara con íconos y secciones por rol; contenido a la derecha. En móvil, barra superior y
  cajón de navegación; en las pantallas de detalle, las acciones quedan fijas abajo.
- Encabezado de contenido con búsqueda global (Ctrl K) y notificaciones.
- Formularios y lectura con ancho máximo; tablas y reportes a todo el ancho.
- Las secciones se separan con espacio y una línea fina, no con tarjetas. La tarjeta (`Tarjeta`) es para
  agrupar algo que se mueve junto (un formulario, una franja de saldo), no para envolver cada sección.
- Espaciado en múltiplos de 4 px.

## Componentes y estados

- **Íconos:** `lucide-react`, contorno, 16–20 px, un solo grosor. Nunca emoji ni símbolos de texto
  (`→ ← ✓ ×`) como íconos en la web. (En WhatsApp los emojis sí: ahí tienen significado fijo.)
- **Acciones de fila:** siempre un botón real (secundario pequeño o fantasma), nunca un enlace suelto.
- **Botones:** primario navy, secundario blanco con borde, fantasma sin borde, peligro rojo. Alto mínimo
  44 px (34 px en filas de tabla con buen espacio alrededor).
- **Un botón desactivado dice por qué** (texto debajo o al lado, enlazado con `aria-describedby`).
- **Estados obligatorios** en cada vista: carga con esqueleto (no spinner de página), vacío que enseña qué
  hacer y ofrece la acción, error con el motivo y "Reintentar", foco visible, hover y desactivado.
- **Estados de negocio** (insignias): punto + texto, con color semántico. El texto dice lo que pasa
  ("Venció hace 4 días"), no solo un estado técnico.
- **Tablas:** encabezado 12/600, filas con hover, montos a la derecha con `tabular-nums`, acciones al final.
- **Gráficos:** barras simples con su valor escrito; leyenda con colores que se distinguen también por
  luminosidad; `role="img"` con `aria-label` que diga los números.

## Movimiento

- 150–250 ms, solo `transform` y `opacity`, curva de salida suave. Se respeta "reducir movimiento" (ya está
  en `styles.css`).
- Sin animaciones coreografiadas al cargar una página.

## Textos

- De **tú** en toda la web (igual que el bot).
- Cortos y concretos: el botón nombra la acción ("Enviar a revisión", no "Continuar"); el error dice qué pasó
  y cómo arreglarlo.
- Sin frases genéricas de IA ("Lo sentimos", "No dudes en", "¡Excelente!").
- Fechas cortas en listas ("12 oct"), largas en encabezados ("12 al 15 de octubre").

## Prohibido (señales de diseño genérico de IA)

- Tarjeta dentro de tarjeta, y grillas de tarjetas iguales (ícono + título + texto) como estructura.
- El "número héroe" (cifra gigante con etiqueta pequeña y estadísticas de relleno).
- Rótulos pequeños en mayúsculas encima de los títulos, y numerar secciones (01, 02…).
- Texto con degradado, fondos con degradado, vidrio o desenfoque decorativo.
- Bordes laterales de color en tarjetas o alertas.
- Sombras grandes o duras; como máximo una sombra sutil para separar algo que flota (menús, paneles).
- Gris sobre fondos de color; el texto sobre color usa un tono del mismo color.
- Modales para lo que se puede resolver en línea o en un panel lateral.
- Animaciones de rebote o elásticas, y puntos que laten.
