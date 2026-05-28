# Búsqueda IA — Diseño

> Fecha: 2026-05-28
> Estado: aprobado (brainstorming)
> Reemplaza/evoluciona la búsqueda de la Fase 2 (`docs/superpowers/plans/2026-05-24-fase-2-busqueda-browse.md`).

## Problema

Encontrar fotos de surf hoy es impráctico por dos dolores:

1. **Volumen / scroll infinito** — el fotógrafo sube cientos de fotos de la jornada y el surfista tiene que scrollear todas para encontrarse.
2. **Fotos dispersas** — están repartidas entre varios fotógrafos, IG, grupos de WhatsApp, Drives; el surfista ni sabe dónde mirar.

Spoteado descartó **reconocimiento facial** por decisión de producto. El peso de "encontrar MI foto" recae entonces en metadata + búsqueda visual (CLIP), potenciada por una capa de entendimiento de lenguaje natural (LLM).

## Objetivo

Una **única búsqueda** que cruza a **todos los fotógrafos** de una playa/día y deja al surfista pasar de cientos de fotos a un puñado describiendo en lenguaje natural quién es y cómo iba: *"longboard azul y roja, en cuero, a la tarde en la mole, el finde pasado"*.

## Principio de diseño central

Hay dos tipos de atributos y **mezclarlos es el error**:

- **Determinísticos / sin ambigüedad → filtros (payload de Qdrant).** Una tabla es longboard o no; el surfista es hombre o mujer; lleva patas de rana o no. Vocabulario fijo en jerga surfera.
- **Difusos / visuales / continuos → el vector CLIP, nunca tags.** El color (una tabla puede ser azul-roja-amarilla-violeta) y la vestimenta del torso (licra, musculosa, remera, "en cuero", traje largo…) son infinitos y se prestan a error como tags. Los describe el surfista en texto libre y los resuelve CLIP mirando la imagen.

Los determinísticos nunca ensucian el vector (son filtros); el color/vestimenta nunca son tags (son vector). Cada cosa en su mecanismo.

## Modelo de datos

### Taxonomía de facetas (vocabulario fijo)

| Tipo | Categoría | Valores |
|---|---|---|
| ☑️ Checkbox | `board_type` | longboard, tabla corta, fish, evolutiva, SUP, bodyboard, bodysurf |
| ☑️ Checkbox | `maneuver` | remando, drop, maniobra, tubo, caída, caminando |
| ☑️ Checkbox | `patas_de_rana` | sí, no |
| ☑️ Checkbox | `sexo` | hombre, mujer |
| ☑️ Checkbox | (existentes) | playa (`beach_slug`), fecha (`captured_at`), horario (`time_block`) |
| 🤖 Vector CLIP | (no es faceta) | color de tabla, color/tipo de traje, vestimenta del torso, apariencia libre |

### Almacenamiento

- **Tabla semilla `facet_values(category, value, label, sort)`** — el vocabulario. Agregar un valor nuevo = un INSERT, **no** una migración de enum. Permite crecer la jerga ("gun", "amarillo flúo") sin tocar el schema.
- **Join `photo_facets(photo_id, category, value)`** con FK a `facet_values` (garantiza vocabulario válido) + RLS (el fotógrafo edita las facetas de sus fotos; lectura pública de fotos `ready`).
- **Payload de Qdrant** (todo indexado como keyword/integer): `board_type[]`, `maneuver[]`, `patas_de_rana`, `sexo`, `beach_slug`, `time_block`, `captured_at`, `session_id`, `status`, `photographer_id`.
- **Vector de Qdrant**: los 1024d de CLIP/Jina (jina-clip-v2) sobre la imagen — captura color y vestimenta.

### Multi-valor (OR dentro de categoría)

El surfista puede tildar varios valores de una misma categoría (ej. tabla "azul" y "verde", o buscar sus fotos + las de un amigo cargando los valores de ambos). Dentro de una categoría se interpreta como **OR**; entre categorías, **AND**.

## Pipeline de búsqueda

Una sola búsqueda, cuatro pasos:

### 1. Entender la query (LLM — Claude Haiku 4.5)

Recibe la frase cruda + contexto (lista de playas conocidas, fecha de hoy) y devuelve JSON estructurado:

```
"longboard azul y roja, en cuero, a la tarde en la mole, el finde pasado"
  ↓
{
  filtros: {
    board_type: ["longboard"],
    time_block: ["afternoon"],
    beach_slug: "la-mole",
    from: "2026-05-23", to: "2026-05-25"
  },
  queryVisual: "blue and red longboard, shirtless surfer"
}
```

- Salida **restringida al vocabulario** (no inventa valores) vía tool use / JSON forzado.
- Resuelve nombres de playa ("la mole" → slug), fechas relativas ("el finde pasado" → rango, usando la fecha de hoy que se le pasa), horarios.
- **System prompt cacheado** (vocabulario + lista de playas son estáticos) → barato y rápido (prompt caching de Anthropic).
- **Fallback robusto**: si el LLM falla o tarda, se busca con CLIP sobre el texto crudo. La búsqueda nunca se cae por el LLM.

### 2. Buscar en Qdrant (una llamada)

Embed de `queryVisual` (Jina/CLIP) → vector search en Qdrant **filtrando el payload** por los determinísticos. Si no hay texto visual, es filtro puro ordenado por recencia.

### 3. Rerank heurístico

Sobre el top-K: `score_final = score_vector + boosts`, donde los boosts premian coincidencias de filtro exactas, recencia y `vote_count`. Pesos tuneables. Lógica pura, testeada con TDD.

### 4. Hidratar y devolver

Traer las fotos de Postgres por IDs, en el orden del rerank → masonry.

## UI

### Surfista (home + `/buscar`)

- **Cuadro de texto natural** como protagonista: *"describí tu sesión: dónde, cuándo, cómo ibas…"*. Entrada principal.
- **Panel "Filtros" plegable** (opcional) con los checkboxes determinísticos (tabla, maniobra, patas de rana, sexo) + playa, fecha, horario. Para quien prefiere clickear sin escribir. Se combinan con lo que el LLM parsea.
- **Interpretación invisible**: lo que el LLM entiende no se muestra como chips; solo se muestran los resultados. Para mitigar el riesgo de mala interpretación:
  - **Estado vacío útil**: *"no encontramos fotos con eso — probá sacar un filtro o describilo distinto"*.
  - El **panel de filtros manual** queda como vía de corrección/control.
- **Resultados**: masonry actual. Lightbox sin cambios.

### Fotógrafo (gestión de fotos)

- Checkboxes de facetas **por foto**, con **tildado masivo** en la grilla (seleccionar varias fotos del mismo surfista → aplicar `board_type` / `sexo` / `patas_de_rana` de un saque), porque suben tandas grandes.
- Playa y horario siguen a nivel sesión (como hoy).
- **Mejora futura (fuera de alcance):** la IA pre-tilda facetas analizando la foto; el fotógrafo solo corrige.

## Migración + testing

### Migración (`supabase/migrations/0005_facets.sql`)

- Crear `facet_values` (con seed del vocabulario) y `photo_facets` (+ RLS).
- **Reemplaza** el sistema de tags libres (`tags` / `photo_tags`): migración best-effort de tags existentes a facetas o se descartan (dev temprano).
- **Backfill**: re-indexar el payload de Qdrant de las fotos ya cargadas (script `.mjs` temporal, patrón usado en Fase 1/2 con `node --env-file=.env.local`).

### Código

- `lib/facets` — vocabulario + validación (lógica pura).
- `lib/search/understand.ts` — capa LLM: NL → `{ filtros, queryVisual }`. Salida estructurada, prompt cacheado, fallback a CLIP crudo. Anthropic detrás de interfaz inyectable (LLM fake para tests).
- `lib/search/route.ts` + `lib/search/execute.ts` — pipeline unificado de 4 pasos (reemplaza el dual-path binario actual).
- `lib/vectors` — payload nuevo por categoría + índices.
- Server actions del fotógrafo — tildado de facetas (individual + masivo) con re-indexado a Qdrant.
- UI: cuadro NL + panel de filtros + estado vacío; grilla de fotógrafo con tildado masivo.

### Testing (TDD, lógica pura primero)

- Scoring del rerank (pesos vector + boosts).
- Armado de filtros de Qdrant (OR intra-categoría, AND inter-categoría).
- Mapeo salida-LLM → filtros, con un **LLM fake** (igual que el embedder fake).
- Validación de facetas contra el vocabulario.
- Verificación en vivo con `.mjs` temporal: ambos caminos (filtro puro y NL→LLM→CLIP), con cleanup al final.

### Stack nuevo

- **Anthropic API** (`claude-haiku-4-5`) para la capa de entendimiento. Requiere `ANTHROPIC_API_KEY` en `.env.local` (único setup pendiente del usuario para esta tanda). MercadoPago queda postergado.

## Fuera de alcance

- Reconocimiento facial (descartado por producto).
- Reranker multimodal cross-encoder (Jina reranker-m0) — el rerank v1 es heurístico; el cross-encoder puede enchufarse después sin reescribir.
- Pre-tildado de facetas por IA en la carga del fotógrafo.
- MercadoPago / Fase 3.
