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

- **Determinísticos / sin ambigüedad → filtros (payload de Qdrant), auto-clasificados por IA al subir.** Una tabla es longboard o no; el surfista es hombre o mujer, goofy o regular; lleva patas de rana o no. Vocabulario fijo en jerga surfera. El fotógrafo no los carga: los detecta la IA con blindaje por confianza.
- **Difusos / visuales / continuos → el vector CLIP, nunca tags.** El color (una tabla puede ser azul-roja-amarilla-violeta) y la vestimenta del torso (licra, musculosa, remera, "en cuero", traje largo…) son infinitos y se prestan a error como tags. Los describe el surfista en texto libre y los resuelve CLIP mirando la imagen.

Los determinísticos nunca ensucian el vector (son filtros); el color/vestimenta nunca son tags (son vector). Cada cosa en su mecanismo.

## Modelo de datos

### Taxonomía de facetas (vocabulario fijo)

Las facetas determinísticas **no las carga el fotógrafo a mano**: las auto-clasifica la IA al subir (ver "Auto-clasificación"). Acá se listan como vocabulario controlado (el surfista filtra por ellas; la IA solo puede asignar estos valores).

| Tipo | Categoría | Valores |
|---|---|---|
| 🤖 auto + filtro | `board_type` | longboard, tabla corta, fish, evolutiva, gun, tabla de espuma, SUP, bodyboard, bodysurf |
| 🤖 auto + filtro | `maneuver` | remando, drop, bottom turn, cutback, floater, aéreo, re-entry (snap), tubo, caída (wipeout), caminando, maniobra (otra) |
| 🤖 auto + filtro | `stance` | goofy, regular |
| 🤖 auto + filtro | `sexo` | hombre, mujer |
| 🤖 auto + filtro | `patas_de_rana` | sí, no |
| ☑️ Filtro | (existentes) | playa (`beach_slug`), fecha (`captured_at`), horario (`time_block`) |
| 🤖 Vector CLIP | (no es faceta) | color de tabla, color/tipo de traje, vestimenta del torso, apariencia libre |

### Almacenamiento

- **Tabla semilla `facet_values(category, value, label, sort)`** — el vocabulario. Agregar un valor nuevo = un INSERT, **no** una migración de enum. Permite crecer la jerga ("gun", "amarillo flúo") sin tocar el schema.
- **Join `photo_facets(photo_id, category, value)`** con FK a `facet_values` (garantiza vocabulario válido) + RLS (escritura solo del dueño de la foto / del proceso de auto-clasificación; lectura pública de fotos `ready`).
- **Payload de Qdrant** (todo indexado como keyword/integer): `board_type[]`, `maneuver[]`, `stance`, `sexo`, `patas_de_rana`, `beach_slug`, `time_block`, `captured_at`, `session_id`, `status`, `photographer_id`. Las facetas que la IA dejó sin asignar (baja confianza) **no aparecen en el payload** (null).
- **Vector de Qdrant**: los 1024d de CLIP/Jina (jina-clip-v2) sobre la imagen — captura color y vestimenta.

### Multi-valor (OR dentro de categoría) + semántica de "vacío"

- El surfista puede elegir varios valores de una misma categoría (ej. `board_type` "longboard" y "fish", o buscar sus fotos + las de un amigo cargando los valores de ambos). Dentro de una categoría se interpreta como **OR**; entre categorías, **AND**.
- **Vacío (null) nunca excluye.** Un filtro por categoría solo descarta fotos que tienen un valor *que contradice* el pedido; las fotos cuya faceta quedó sin asignar (la IA no estuvo segura) **siguen apareciendo**. Priorizamos no perder la foto del surfista por sobre filtrar perfecto. En Qdrant esto se modela con un filtro `should`/`must` que admite ausencia del campo.

## Pipeline de búsqueda

Una sola búsqueda, cuatro pasos:

### 1. Entender la query (LLM — OpenAI GPT)

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

- Salida **restringida al vocabulario** (no inventa valores) vía Structured Outputs / function calling (JSON schema forzado).
- Resuelve nombres de playa ("la mole" → slug), fechas relativas ("el finde pasado" → rango, usando la fecha de hoy que se le pasa), horarios.
- System prompt estático (vocabulario + lista de playas) → conviene mantenerlo estable para aprovechar el caching del proveedor.
- **Fallback robusto**: si el LLM falla o tarda, se busca con CLIP sobre el texto crudo. La búsqueda nunca se cae por el LLM.

### 2. Buscar en Qdrant (una llamada)

Embed de `queryVisual` (Jina/CLIP) → vector search en Qdrant **filtrando el payload** por los determinísticos. Si no hay texto visual, es filtro puro ordenado por recencia.

### 3. Rerank heurístico

Sobre el top-K: `score_final = score_vector + boosts`, donde los boosts premian coincidencias de filtro exactas, recencia y `vote_count`. Pesos tuneables. Lógica pura, testeada con TDD.

### 4. Hidratar y devolver

Traer las fotos de Postgres por IDs, en el orden del rerank → masonry.

## Auto-clasificación de facetas (al subir)

El fotógrafo **no carga facetas a mano**. En el pipeline de procesamiento asíncrono que ya existe (`processPhoto`), además de generar el embedding CLIP, se llama a un **VLM de visión de OpenAI (GPT)** que mira la imagen y devuelve las facetas determinísticas (`board_type`, `maneuver`, `stance`, `sexo`, `patas_de_rana`) con un **nivel de confianza** por faceta.

- **Salida estructurada** (JSON schema forzado) restringida al vocabulario controlado.
- **Blindaje por confianza**: una faceta se asigna **solo si la confianza supera un umbral**. Si la IA duda, la faceta queda **sin asignar (null)** — y un valor vacío nunca excluye fotos en la búsqueda (ver "semántica de vacío"). Mejor no taggear que taggear mal: un tag erróneo haría desaparecer la foto del surfista sin que sepa por qué.
- Las facetas asignadas se escriben en `photo_facets` y se sincronizan al payload de Qdrant (mismo re-indexado idempotente que ya usa el pipeline).
- VLM detrás de una **interfaz inyectable** (`lib/classify`), con un **clasificador fake** para tests (igual patrón que el embedder fake).
- **Idempotente / re-ejecutable**: re-procesar una foto re-clasifica sin duplicar.
- **Mejora futura (fuera de alcance):** correr varias fotos en batch / afinar el umbral con datos reales.

## UI

### Surfista (home + `/buscar`)

- **Cuadro de texto natural** como protagonista: *"describí tu sesión: dónde, cuándo, cómo ibas…"*. Entrada principal.
- **Panel "Filtros" plegable** (opcional) con los checkboxes determinísticos (tabla, maniobra, stance, sexo, patas de rana) + playa, fecha, horario. Para quien prefiere clickear sin escribir. Se combinan con lo que el LLM parsea.
- **Interpretación invisible**: lo que el LLM entiende no se muestra como chips; solo se muestran los resultados. Para mitigar el riesgo de mala interpretación:
  - **Estado vacío útil**: *"no encontramos fotos con eso — probá sacar un filtro o describilo distinto"*.
  - El **panel de filtros manual** queda como vía de corrección/control.
- **Resultados**: masonry actual. Lightbox sin cambios.

### Fotógrafo (gestión de fotos)

- **Sin tildado manual de facetas.** El fotógrafo sube y la IA clasifica (ver "Auto-clasificación"). Sigue cargando lo de siempre: playa, horario y precio a nivel sesión/foto.
- **Mejora futura (fuera de alcance):** UI de corrección para que el fotógrafo ajuste una faceta mal clasificada si lo nota.

## Migración + testing

### Migración (`supabase/migrations/0005_facets.sql`)

- Crear `facet_values` (con seed del vocabulario, incluyendo `stance`) y `photo_facets` (+ RLS).
- **Reemplaza** el sistema de tags libres (`tags` / `photo_tags`): migración best-effort de tags existentes a facetas o se descartan (dev temprano).
- **Backfill**: re-procesar las fotos ya cargadas para auto-clasificar facetas + re-indexar el payload de Qdrant (script `.mjs` temporal, patrón usado en Fase 1/2 con `node --env-file=.env.local`).

### Código

- `lib/facets` — vocabulario + validación (lógica pura).
- `lib/classify` — VLM de visión (OpenAI GPT): imagen → facetas + confianza, con umbral. Detrás de interfaz inyectable (clasificador fake para tests).
- `lib/search/understand.ts` — capa LLM (OpenAI GPT): NL → `{ filtros, queryVisual }`. Salida estructurada, fallback a CLIP crudo. Detrás de interfaz inyectable (LLM fake para tests).
- `lib/search/route.ts` + `lib/search/execute.ts` — pipeline unificado de 4 pasos (reemplaza el dual-path binario actual).
- `lib/vectors` — payload nuevo por categoría + índices; semántica de "vacío no excluye".
- `processPhoto` — sumar el paso de auto-clasificación al pipeline existente.
- UI: cuadro NL + panel de filtros + estado vacío.

### Testing (TDD, lógica pura primero)

- Scoring del rerank (pesos vector + boosts).
- Armado de filtros de Qdrant (OR intra-categoría, AND inter-categoría, vacío no excluye).
- Mapeo salida-LLM → filtros, con un **LLM fake** (igual que el embedder fake).
- Auto-clasificación: umbral de confianza → asigna vs deja null, con **clasificador fake**.
- Validación de facetas contra el vocabulario.
- Verificación en vivo con `.mjs` temporal: clasificación al subir + ambos caminos de búsqueda (filtro puro y NL→LLM→CLIP), con cleanup al final.

### Stack nuevo

- **OpenAI API (GPT)** para dos cosas: (a) auto-clasificación de facetas por visión al subir, y (b) entendimiento de la query en búsqueda. Requiere `OPENAI_API_KEY` en `.env.local` (único setup pendiente del usuario para esta tanda). Versiones exactas de modelo (visión / texto) se confirman al implementar.
- MercadoPago / Fase 3 quedan postergados.

## Fuera de alcance

- Reconocimiento facial (descartado por producto).
- Reranker multimodal cross-encoder (Jina reranker-m0) — el rerank v1 es heurístico; el cross-encoder puede enchufarse después sin reescribir.
- UI de corrección manual de facetas mal clasificadas (la clasificación es automática en v1).
- MercadoPago / Fase 3.
