# Spoteado — Documento de Diseño (UI/UX)

- **Fecha:** 2026-05-24
- **Estado:** Aprobado para pasar a plan de implementación
- **Relacionado:** complementa `2026-05-24-spoteado-design.md` (arquitectura). Este doc cubre el diseño visual y de interacción.

---

## 1. Principio rector

**La interfaz desaparece, la foto manda.** Estética editorial / galería premium: blanco, aire y tipografía; el color lo ponen las fotos. Cada decisión de diseño se mide contra esto: si una pieza de UI compite con la foto, sobra.

Contexto de uso: **surfista en móvil** (en la playa, una mano) y **fotógrafo en desktop** (sube tandas grandes, gestiona).

## 2. Sistema visual

**Paleta**
- Fondo: blanco cálido casi puro `#FAFAF9` (las fotos "flotan").
- Texto: casi negro `#0A0A0A`; grises refinados para secundario y **bordes hairline** (1px).
- Acento único y contenido: **teal océano profundo** para lo interactivo (CTA primario, filtro activo, links). Único guiño de color a la cultura surf.
- Voto: corazón en **coral cálido** (solo al votar).
- Regla de oro: ante la duda, blanco/negro. El color es excepción.

**Tipografía** (vía `next/font`)
- Títulos/display: serif refinada (ej. *Fraunces* o *Newsreader*) → aire de revista de fotografía.
- UI/cuerpo: sans limpia (ej. *Inter* o *Geist*).
- Tamaños generosos, tracking ajustado en display, poco texto bien jerarquizado.

**Espaciado y layout**
- Whitespace generoso; divisores hairline en vez de cajas/sombras.
- Fotos a sangre (edge-to-edge), esquinas rectas; botones con radio mínimo.
- Móvil: targets táctiles grandes.

**Movimiento** (sutil, premium)
- **Blur-up** al cargar imágenes (placeholder borroso → nítido).
- Transición suave del lightbox (la foto crece desde su lugar en la grilla). Nada estridente.

**Tono de copy:** mínimo, seguro, surfer sin clichés. Pocas palabras.

## 3. Mapa de pantallas (IA) y navegación

```
PÚBLICO / SURFISTA
├── Home                      hero + buscador + ganadoras de la semana
├── Resultados de búsqueda    masonry + filtros (playa, fecha, hora, tags) + texto NL
│   └── Lightbox              overlay: foto grande, precio, carrito, → siguiente
├── Sesión                    fotos de una sesión + precio del pack
├── Perfil del fotógrafo      galería editorial + sesiones
├── Ranking / Hall of fame    ganadoras de la semana actual + pasadas
├── Carrito                   ítems agrupados por fotógrafo
├── Checkout → MercadoPago    (redirección) → Confirmación
├── Mis fotos compradas       descargas full-res (signed URLs, sin watermark)
└── Auth                      login / signup (elegís rol)

FOTÓGRAFO (logueado)
├── Dashboard                 ventas, fotos recientes, estados de procesamiento
├── Subir                     crear sesión → upload → estado por-foto (⏳→✅)
├── Mis fotos / sesiones       gestión: precios, tags, pack_price, cover, borrar
├── Ventas / ganancias        órdenes, bruto, comisión, neto
├── Mi perfil público         preview de su vidriera
└── Configuración             payout MercadoPago + watermark (logo, posición, opacidad)
```

**Navegación global (minimalista)**
- **Top bar finita** (público): izquierda wordmark *Spoteado* (serif); derecha buscador compacto (en resultados), link **Ranking**, **carrito** (solo si hay ítems), **avatar/menú** (o "Ingresar").
- **Mobile — bottom tab bar ergonómica** para el surfista: **Buscar · Ranking · Carrito · Mis fotos** (al alcance del pulgar).
- **Fotógrafo:** dashboard con nav propia (sidebar en desktop, drawer en móvil): Dashboard · Subir · Mis fotos · Ventas · Perfil · Config. Editorial pero organizada para trabajar.
- El surfista nunca ve chrome de gestión; el fotógrafo alterna entre "su vidriera pública" y "su taller".

## 4. Pantallas del surfista (móvil primero)

**Home**
```
┌──────────────────────────┐
│ Spoteado            [@]   │
│    [ foto hero a sangre ]│
│  ┌─────────────────────┐ │
│  │ 🔍 Playa            │ │  card de búsqueda superpuesta
│  │ 📅 Fecha            │ │
│  │ "describí tu foto…" │ │  campo lenguaje natural
│  │      [ Buscar ]     │ │  CTA teal
│  └─────────────────────┘ │
│ Mejores de la semana  🏆 │  scroll horizontal de ganadoras
│ Buscar  Ranking  🛒  Mis │  bottom tab bar
└──────────────────────────┘
```
*Desktop:* hero más alto, card centrada; ganadoras en fila de 3-4.

**Resultados**
```
┌──────────────────────────┐
│ ← Mar del Plata · Hoy  ⚙ │  resumen de búsqueda (tap=editar) + filtros
│   "traje rojo"           │
│ 124 fotos · recientes ▾  │  conteo + orden (recientes / +votadas / relevancia)
│ ┌────────┐  ┌─────────┐  │  MASONRY 2 col, previews con watermark
│ │  📷  ❤ │  │   📷    │  │  corazón para votar
│ └────────┘  └─────────┘  │  scroll infinito
│ Buscar  Ranking  🛒  Mis │
└──────────────────────────┘
```
*Filtros (drawer al tocar ⚙):* playa · fecha/rango · franja horaria · tags. *Desktop:* masonry 3-4 col, filtros en sidebar fijo.

**Lightbox** (full-screen en móvil)
```
┌──────────────────────────┐
│ ✕                   ❤ 12 │  cerrar + votar
│   [ foto con watermark ] │  swipe ← → anterior/siguiente
│ 📷 @fotografo_juan       │  crédito (→ perfil)
│ Mar del Plata · 24 may   │  metadata
│ #trajeRojo #backside     │  tags
│ $X.XXX      [ Agregar 🛒]│  precio + al carrito (teal)
│ Pack de la sesión (12)   │  upsell del pack
│ $XX.XXX     [ Ver sesión]│
└──────────────────────────┘
```
*Desktop:* modal centrado, foto a la izquierda + panel de info/compra a la derecha.

**Carrito** — agrupado por fotógrafo (consecuencia de "una orden por fotógrafo")
```
│ 📷 @fotografo_juan                 │
│  ▢ Foto suelta  $X  ▢ Pack $XX     │
│  Subtotal $XXX   [ Pagar a Juan ]  │  checkout de ESTE fotógrafo
│ 📷 @ana_surf_pics                  │
│  ▢ Foto suelta  $X  [ Pagar a Ana ]│
```
Si comprás a 2 fotógrafos → 2 pagos separados en MercadoPago. La UI lo hace explícito (subtotal + "Pagar a X" por grupo) para que no confunda.

**Mis fotos compradas** — grid simple, **sin watermark**, botón de descarga (signed URL TTL corto), agrupadas por compra/fecha.

## 5. Pantallas del fotógrafo (desktop primero)

**Shell:** sidebar (Dashboard · Subir · Mis fotos · Ventas · Perfil · Config) + contenido. Responsive: sidebar → drawer en móvil.

**Dashboard:** stat cards en hairline (ventas semana, ganado mes, fotos activas) + "Procesando ahora" (progreso de uploads) + últimas ventas.

**Subir:**
```
│ 1) Sesión: [ Playa ▾ ] [ Fecha ] [ Franja ▾ ] + Título │
│ 2) [ Arrastrá tus fotos · elegir ]  (subida directa a Storage)
│    ▢⏳ ▢✅ ▢✅ ▢❌ reintentar ▢✅ …   (estado por-foto, en paralelo)
│ 3) Al terminar → setear precios y tags
```

**Mis fotos / sesiones:** sesiones colapsables; selección + acciones masivas (precio/tags en lote); editar precio/tags por foto; editar `pack_price` y cover.

**Ventas / ganancias:** tabla editorial (fecha, ítem, comprador, bruto, comisión, neto) + neto del mes.

**Configuración:** conectar MercadoPago (OAuth → habilita split/payout) + marca de agua (subir logo, posición, opacidad) con **preview en vivo**.

**Perfil público:** "Ver como público" — su vidriera editorial igual a la que ven los surfers.

**Gating:** sin cuenta de MercadoPago conectada/verificada, sus fotos se suben y muestran pero **no se pueden comprar** (banner "Conectá tu cuenta para vender").

## 6. Componentes transversales y estados

- **Photo card:** preview con watermark, blur-up al cargar, overlay de corazón (voto) y precio al hover/tap.
- **Buscador:** componente reutilizable (playa + fecha + franja + texto NL); compacto en la top bar de resultados, expandido en la home.
- **Estados:**
  - *Loading:* skeletons con el mismo ritmo del masonry; blur-up en imágenes.
  - *Empty:* búsqueda sin resultados → mensaje + sugerencia de ampliar filtros (atado al fallback del spec de arquitectura).
  - *Error:* mensajes amables y accionables; nunca stack traces.
  - *Procesando (fotógrafo):* ⏳ por foto; *fallida* → ❌ con "reintentar".
- **Auth:** pantalla mínima (email + Google), con elección de rol en el signup.
- **Voto:** corazón coral, toggle optimista (UI responde al toque, confirma en background).

## 7. Responsive / mobile-first

- **Surfista:** diseñado primero para móvil. Masonry 2 col (móvil) → 3-4 (desktop); hero + buscador apilados (móvil) → centrados (desktop); lightbox full-screen (móvil) → modal con panel lateral (desktop); bottom tab bar (móvil) → top bar (desktop).
- **Fotógrafo:** diseñado primero para desktop (bulk upload, gestión). Sidebar → drawer en móvil; tablas → listas apiladas.

## 8. Decisiones de diseño (recap)

| Tema | Decisión |
|---|---|
| Estética | Editorial / galería premium (foto-primero, blanco + aire) |
| Home | Hero full-bleed + buscador superpuesto + ganadoras debajo |
| Grilla | Masonry (frame completo, no recorta al surfista) |
| Detalle/compra | Lightbox (overlay sobre la grilla) |
| Dashboard fotógrafo | Mismo lenguaje editorial |
| Nav móvil | Bottom tab bar (surfista) |
| Paleta | Blanco cálido + casi-negro + 1 acento teal + corazón coral |
| Tipografía | Serif display (Fraunces/Newsreader) + sans UI (Inter/Geist) |

## 9. Fuera de alcance / futuro

- Tematización/branding por fotógrafo más allá del watermark.
- Checkout unificado multi-fotógrafo (arrancamos con pagos separados por fotógrafo).
- Modo oscuro (la galería editorial clara es la apuesta inicial).
- App nativa (PWA responsive primero).
