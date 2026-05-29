# Búsqueda IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Spec:** `docs/superpowers/specs/2026-05-28-busqueda-ia-design.md`

**Goal:** Reemplazar la búsqueda dual-path binaria por un motor unificado donde filtros en jerga surfera (auto-clasificados por IA al subir) acotan, una capa LLM rutea el lenguaje natural a filtros + query visual, CLIP ordena y un rerank heurístico ajusta — para que el surfista pase de cientos de fotos a un puñado.

**Architecture:** Las facetas determinísticas (`board_type`, `maneuver`, `stance`, `sexo`, `patas_de_rana`) se auto-clasifican con un VLM de OpenAI en el pipeline `processPhoto` (asignación solo si supera umbral de confianza; si no, queda null) y se guardan en `photo_facets` (Postgres) + payload de Qdrant. En búsqueda, un LLM de OpenAI convierte la frase natural en `{ filtros, queryVisual }`; se hace una sola llamada a Qdrant (filtro de payload donde "vacío no excluye" + similitud del vector de `queryVisual`); un rerank heurístico reordena; se hidrata desde Postgres. Toda la lógica de IA está detrás de interfaces inyectables con fakes para test.

**Tech Stack:** Next.js 16 (App Router, route handlers, Server Components), TypeScript, Supabase (Postgres + RLS), Qdrant (`@qdrant/js-client-rest`), Jina `jina-clip-v2` (embeddings), OpenAI SDK (`openai`, visión + texto), Vitest.

---

## File Structure

```
lib/facets/index.ts                 vocabulario controlado + validación (puro)
lib/facets/index.test.ts
lib/classify/index.ts               Classifier interface + impl OpenAI visión + applyThreshold (puro)
lib/classify/fake.ts                FakeClassifier para tests
lib/classify/threshold.test.ts
lib/search/understand.ts            QueryUnderstander interface + impl OpenAI + fallback
lib/search/understand.fake.ts       FakeUnderstander para tests
lib/search/rerank.ts                rerank heurístico (puro)
lib/search/rerank.test.ts
lib/search/types.ts                 (modificar) ParsedFilters, QueryUnderstanding, etc.
lib/search/route.ts                 (modificar) parseSearchParams + buildVectorFilter con facetas
lib/search/route.test.ts            (modificar)
lib/search/execute.ts               (modificar) pipeline unificado de 4 pasos
lib/search/execute.test.ts          (modificar)
lib/vectors/index.ts                (modificar) payload por faceta + índices + filtro "vacío no excluye"
lib/vectors/payload.test.ts         (modificar)
lib/photos/types.ts                 (modificar) ProcessDeps + classifyFacets / indexFacets
lib/photos/process.ts               (modificar) paso de auto-clasificación
lib/photos/process.test.ts          (modificar)
lib/env.ts                          (modificar) + OPENAI_API_KEY
app/api/photos/[id]/process/route.ts (modificar) wire classifier
app/(public)/buscar/page.tsx        (modificar) wire understand + rerank + facetas
components/search/search-bar.tsx    (modificar) caja NL + panel filtros plegable
supabase/migrations/0005_facets.sql facet_values (seed) + photo_facets + RLS; drop tags
scripts/backfill-facets.mjs         backfill: re-clasificar + re-indexar fotos existentes
```

**Checkpoint de envío:** al terminar la **Tarea 7** la auto-clasificación queda funcionando end-to-end (foto subida → facetas en DB + Qdrant). Tareas 8–13 construyen la búsqueda encima.

---

## Task 1: Vocabulario de facetas (lib/facets)

**Files:**
- Create: `lib/facets/index.ts`
- Test: `lib/facets/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/facets/index.test.ts
import { describe, it, expect } from 'vitest'
import { FACET_CATEGORIES, FACET_VOCAB, isValidFacet, sanitizeFacets } from '@/lib/facets'

describe('FACET_VOCAB', () => {
  it('tiene las cinco categorías determinísticas', () => {
    expect(FACET_CATEGORIES.sort()).toEqual(
      ['board_type', 'maneuver', 'patas_de_rana', 'sexo', 'stance'].sort()
    )
  })
  it('incluye la jerga acordada', () => {
    expect(FACET_VOCAB.board_type).toContain('longboard')
    expect(FACET_VOCAB.board_type).toContain('gun')
    expect(FACET_VOCAB.board_type).toContain('bodysurf')
    expect(FACET_VOCAB.maneuver).toContain('floater')
    expect(FACET_VOCAB.maneuver).toContain('aereo')
    expect(FACET_VOCAB.stance).toEqual(['goofy', 'regular'])
  })
})

describe('isValidFacet', () => {
  it('acepta valores del vocabulario', () => {
    expect(isValidFacet('board_type', 'longboard')).toBe(true)
  })
  it('rechaza categoría o valor desconocido', () => {
    expect(isValidFacet('board_type', 'inventado')).toBe(false)
    expect(isValidFacet('color', 'azul')).toBe(false)
  })
})

describe('sanitizeFacets', () => {
  it('descarta facetas fuera del vocabulario', () => {
    const out = sanitizeFacets([
      { category: 'board_type', value: 'longboard' },
      { category: 'sexo', value: 'alien' },
      { category: 'stance', value: 'goofy' },
    ])
    expect(out).toEqual([
      { category: 'board_type', value: 'longboard' },
      { category: 'stance', value: 'goofy' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/facets`
Expected: FAIL ("Cannot find module '@/lib/facets'").

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/facets/index.ts
export type FacetCategory =
  | 'board_type'
  | 'maneuver'
  | 'stance'
  | 'sexo'
  | 'patas_de_rana'

// Vocabulario controlado en jerga surfera (slugs sin acento, aptos como keyword Qdrant / valor FK).
export const FACET_VOCAB: Record<FacetCategory, string[]> = {
  board_type: ['longboard', 'tabla-corta', 'fish', 'evolutiva', 'gun', 'espuma', 'sup', 'bodyboard', 'bodysurf'],
  maneuver: ['remando', 'drop', 'bottom-turn', 'cutback', 'floater', 'aereo', 're-entry', 'tubo', 'caida', 'caminando', 'maniobra'],
  stance: ['goofy', 'regular'],
  sexo: ['hombre', 'mujer'],
  patas_de_rana: ['si', 'no'],
}

export const FACET_CATEGORIES = Object.keys(FACET_VOCAB) as FacetCategory[]

export type Facet = { category: FacetCategory; value: string }

export function isValidFacet(category: string, value: string): boolean {
  const vals = FACET_VOCAB[category as FacetCategory]
  return Boolean(vals && vals.includes(value))
}

export function sanitizeFacets(facets: { category: string; value: string }[]): Facet[] {
  return facets.filter((f) => isValidFacet(f.category, f.value)) as Facet[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/facets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/facets/index.ts lib/facets/index.test.ts
git commit -m "feat(facets): vocabulario controlado de jerga + validación"
```

---

## Task 2: Migración 0005 — facet_values + photo_facets + drop tags

**Files:**
- Create: `supabase/migrations/0005_facets.sql`

> Nota: esta migración se aplica en vivo después (la verificación end-to-end es en Tarea 7/13). El seed de `facet_values` DEBE coincidir con `FACET_VOCAB` de la Tarea 1.

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/0005_facets.sql — facetas en jerga (vocabulario controlado) + auto-clasificación

-- 1. Vocabulario controlado. Agregar un valor nuevo = un INSERT, no una migración de enum.
create table public.facet_values (
  category text not null,
  value    text not null,
  label    text not null,
  sort     int  not null default 0,
  primary key (category, value)
);

-- 2. Facetas asignadas a cada foto (por la IA). FK al vocabulario garantiza valores válidos.
create table public.photo_facets (
  photo_id   uuid not null references public.photos (id) on delete cascade,
  category   text not null,
  value      text not null,
  confidence numeric,
  primary key (photo_id, category),
  foreign key (category, value) references public.facet_values (category, value)
);
create index photo_facets_lookup_idx on public.photo_facets (category, value);

-- 3. Seed del vocabulario (coincide con lib/facets FACET_VOCAB).
insert into public.facet_values (category, value, label, sort) values
  ('board_type','longboard','Longboard',1),
  ('board_type','tabla-corta','Tabla corta',2),
  ('board_type','fish','Fish',3),
  ('board_type','evolutiva','Evolutiva',4),
  ('board_type','gun','Gun',5),
  ('board_type','espuma','Tabla de espuma',6),
  ('board_type','sup','SUP',7),
  ('board_type','bodyboard','Bodyboard',8),
  ('board_type','bodysurf','Bodysurf',9),
  ('maneuver','remando','Remando',1),
  ('maneuver','drop','Drop',2),
  ('maneuver','bottom-turn','Bottom turn',3),
  ('maneuver','cutback','Cutback',4),
  ('maneuver','floater','Floater',5),
  ('maneuver','aereo','Aéreo',6),
  ('maneuver','re-entry','Re-entry',7),
  ('maneuver','tubo','Tubo',8),
  ('maneuver','caida','Caída',9),
  ('maneuver','caminando','Caminando',10),
  ('maneuver','maniobra','Maniobra',11),
  ('stance','goofy','Goofy',1),
  ('stance','regular','Regular',2),
  ('sexo','hombre','Hombre',1),
  ('sexo','mujer','Mujer',2),
  ('patas_de_rana','si','Con patas de rana',1),
  ('patas_de_rana','no','Sin patas de rana',2);

-- 4. RLS
alter table public.facet_values enable row level security;
alter table public.photo_facets enable row level security;

create policy "facet_values visibles" on public.facet_values for select using (true);

-- Lectura pública de facetas de fotos ready; el fotógrafo ve las suyas.
create policy "photo_facets visibles" on public.photo_facets for select
  using (exists (
    select 1 from public.photos p
    where p.id = photo_facets.photo_id
      and (p.status = 'ready' or p.photographer_id = auth.uid())
  ));

-- Escritura solo del dueño de la foto (la auto-clasificación corre con el admin client, que saltea RLS).
create policy "fotografo gestiona facetas de sus fotos" on public.photo_facets for all
  using (exists (
    select 1 from public.photos p
    where p.id = photo_facets.photo_id and p.photographer_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.photos p
    where p.id = photo_facets.photo_id and p.photographer_id = auth.uid()
  ));

-- 5. Eliminar el sistema de tags libres (reemplazado por facetas). Dev temprano: se descartan.
drop table if exists public.photo_tags;
drop table if exists public.tags;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0005_facets.sql
git commit -m "feat(db): migración facet_values + photo_facets, drop tags libres"
```

---

## Task 3: Payload de Qdrant por faceta + filtro "vacío no excluye"

**Files:**
- Modify: `lib/vectors/index.ts`
- Modify: `lib/vectors/payload.test.ts`

- [ ] **Step 1: Write the failing test** (reemplaza el contenido de `payload.test.ts`)

```ts
// lib/vectors/payload.test.ts
import { describe, it, expect } from 'vitest'
import { buildPayload, buildSearchFilter, type PhotoVectorInput } from '@/lib/vectors'

const base: PhotoVectorInput = {
  id: 'p1',
  photographer_id: 'u1',
  beach_slug: 'la-mole',
  captured_at: '2026-05-24T12:00:00Z',
  time_block: 'afternoon',
  facets: { board_type: 'longboard', stance: 'goofy' },
  status: 'ready',
  session_id: null,
}

describe('buildPayload', () => {
  it('convierte captured_at a epoch y aplana facetas asignadas', () => {
    const p = buildPayload(base)
    expect(p.captured_at).toBe(Math.floor(Date.parse(base.captured_at) / 1000))
    expect(p.board_type).toBe('longboard')
    expect(p.stance).toBe('goofy')
  })
  it('omite facetas no asignadas (null) en vez de escribir el campo', () => {
    const p = buildPayload(base)
    expect('sexo' in p).toBe(false)
    expect('maneuver' in p).toBe(false)
    expect('patas_de_rana' in p).toBe(false)
  })
})

describe('buildSearchFilter', () => {
  it('siempre exige status ready', () => {
    const f = buildSearchFilter({})
    expect(f.must).toContainEqual({ key: 'status', match: { value: 'ready' } })
  })
  it('una faceta requerida hace match OR de valores y NO excluye fotos sin el campo', () => {
    const f = buildSearchFilter({ facets: { board_type: ['longboard', 'fish'] } })
    expect(f.must).toContainEqual({
      should: [
        { key: 'board_type', match: { any: ['longboard', 'fish'] } },
        { is_empty: { key: 'board_type' } },
      ],
    })
  })
  it('combina beach + rango de fechas en must', () => {
    const f = buildSearchFilter({ beach_slug: 'la-mole', capturedFrom: 100, capturedTo: 200 })
    expect(f.must).toContainEqual({ key: 'beach_slug', match: { value: 'la-mole' } })
    expect(f.must).toContainEqual({ key: 'captured_at', range: { gte: 100, lte: 200 } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/vectors`
Expected: FAIL (`facets` no existe en `PhotoVectorInput`, `buildSearchFilter` no exportado).

- [ ] **Step 3: Reescribir `lib/vectors/index.ts`**

```ts
// lib/vectors/index.ts
import { QdrantClient } from '@qdrant/js-client-rest'
import { env } from '@/lib/env'
import { EMBEDDING_DIM } from '@/lib/embeddings'
import { FACET_CATEGORIES, type FacetCategory } from '@/lib/facets'

export const PHOTOS_COLLECTION = 'photos'

// Facetas asignadas a una foto: a lo sumo un valor por categoría (null = no asignada).
export type PhotoFacets = Partial<Record<FacetCategory, string>>

export type PhotoVectorInput = {
  id: string
  photographer_id: string
  beach_slug: string
  captured_at: string // ISO
  time_block: string | null
  facets: PhotoFacets
  status: string
  session_id: string | null
}

export type PhotoPayload = {
  id: string
  photographer_id: string
  beach_slug: string
  captured_at: number
  time_block: string | null
  status: string
  session_id: string | null
} & Partial<Record<FacetCategory, string>>

export function buildPayload(input: PhotoVectorInput): PhotoPayload {
  const payload: PhotoPayload = {
    id: input.id,
    photographer_id: input.photographer_id,
    beach_slug: input.beach_slug,
    captured_at: Math.floor(Date.parse(input.captured_at) / 1000),
    time_block: input.time_block,
    status: input.status,
    session_id: input.session_id,
  }
  // Solo se escriben las facetas asignadas; las null se omiten (para que "is_empty" funcione).
  for (const cat of FACET_CATEGORIES) {
    const v = input.facets[cat]
    if (v) payload[cat] = v
  }
  return payload
}

let client: QdrantClient | null = null
function qdrant() {
  if (!client) client = new QdrantClient({ url: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY })
  return client
}

// Qdrant exige un índice de payload en cada campo usado para filtrar.
const PAYLOAD_INDEXES: { field: string; schema: 'keyword' | 'integer' }[] = [
  { field: 'status', schema: 'keyword' },
  { field: 'beach_slug', schema: 'keyword' },
  { field: 'time_block', schema: 'keyword' },
  { field: 'session_id', schema: 'keyword' },
  { field: 'captured_at', schema: 'integer' },
  ...FACET_CATEGORIES.map((f) => ({ field: f, schema: 'keyword' as const })),
]

export async function ensureCollection() {
  const exists = await qdrant().collectionExists(PHOTOS_COLLECTION)
  if (!exists.exists) {
    await qdrant().createCollection(PHOTOS_COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: 'Cosine' },
    })
  }
  for (const { field, schema } of PAYLOAD_INDEXES) {
    try {
      await qdrant().createPayloadIndex(PHOTOS_COLLECTION, { field_name: field, field_schema: schema })
    } catch {
      // índice ya existente → continuar
    }
  }
}

export async function upsertPhoto(vector: number[], input: PhotoVectorInput) {
  await qdrant().upsert(PHOTOS_COLLECTION, {
    points: [{ id: input.id, vector, payload: buildPayload(input) }],
  })
}

export async function setPhotoFacetsPayload(photoId: string, facets: PhotoFacets) {
  await qdrant().setPayload(PHOTOS_COLLECTION, { payload: facets, points: [photoId] })
}

export async function deletePhoto(id: string) {
  await qdrant().delete(PHOTOS_COLLECTION, { points: [id] })
}

export type SearchFilter = {
  beach_slug?: string
  time_block?: string[]
  facets?: Partial<Record<FacetCategory, string[]>>
  capturedFrom?: number
  capturedTo?: number
}

// "Vacío no excluye": por cada categoría pedida, la foto matchea si su valor está
// entre los pedidos O si no tiene la faceta asignada (is_empty).
export function buildSearchFilter(filter: SearchFilter): { must: object[] } {
  const must: object[] = [{ key: 'status', match: { value: 'ready' } }]
  if (filter.beach_slug) must.push({ key: 'beach_slug', match: { value: filter.beach_slug } })
  if (filter.time_block?.length) {
    must.push({ should: [
      { key: 'time_block', match: { any: filter.time_block } },
      { is_empty: { key: 'time_block' } },
    ] })
  }
  for (const [cat, values] of Object.entries(filter.facets ?? {})) {
    if (!values?.length) continue
    must.push({ should: [
      { key: cat, match: { any: values } },
      { is_empty: { key: cat } },
    ] })
  }
  if (filter.capturedFrom || filter.capturedTo) {
    must.push({ key: 'captured_at', range: { gte: filter.capturedFrom, lte: filter.capturedTo } })
  }
  return { must }
}

export async function searchPhotos(vector: number[], filter: SearchFilter, limit = 60) {
  const res = await qdrant().search(PHOTOS_COLLECTION, { vector, filter: buildSearchFilter(filter), limit })
  return res.map((r) => ({ id: String(r.id), score: r.score }))
}

// Camino sin texto visual: recupera IDs por filtro de payload (facet-aware) sin vector.
export async function scrollPhotos(filter: SearchFilter, limit = 60): Promise<string[]> {
  const res = await qdrant().scroll(PHOTOS_COLLECTION, {
    filter: buildSearchFilter(filter),
    limit,
    with_payload: false,
    with_vector: false,
  })
  return res.points.map((p) => String(p.id))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/vectors`
Expected: PASS.

- [ ] **Step 5: Limpiar el sistema de tags (acoplado a este cambio)**

Al reescribir `lib/vectors` desaparece `setPhotoTagsPayload` y `PhotoVectorInput.tags`. Para no dejar imports colgados, eliminar las referencias al sistema de tags libres en el mismo cambio. Buscar usos:

Run: `grep -rn "setPhotoTags\|setPhotoTagsPayload\|photo_tags\|from('tags')" app components lib --include=*.ts --include=*.tsx`
Expected: al menos `app/(dashboard)/_actions/catalog.ts` y (según Fase 2) una UI de tags en el dashboard.

- En `app/(dashboard)/_actions/catalog.ts`: eliminar la función `setPhotoTags` completa y el import `import { setPhotoTagsPayload } from '@/lib/vectors'`. (Las facetas las pone la IA, no el fotógrafo.)
- Para cada componente/página del dashboard que el grep marque usando `setPhotoTags`: quitar el control de tags (input + submit). No reemplazar por nada — la clasificación es automática.

- [ ] **Step 6: Verificar tests aislados**

Run: `npm test -- lib/vectors`
Expected: PASS.
> Nota: NO correr `npx tsc --noEmit` todavía. `route.ts`/`execute.ts`/`buscar/page.tsx` viejos quedan inconsistentes con el nuevo `SearchFilter` hasta la Tarea 12; el type-check de proyecto completo se hace recién en la Tarea 12. Hasta entonces, el gate de cada tarea es su `vitest` aislado.

- [ ] **Step 7: Commit**

```bash
git add lib/vectors/index.ts lib/vectors/payload.test.ts app components
git commit -m "feat(vectors): payload por faceta + filtro vacío-no-excluye; drop tags libres"
```

---

## Task 4: Variable de entorno OPENAI_API_KEY

**Files:**
- Modify: `lib/env.ts`
- Modify: `lib/env.test.ts`

- [ ] **Step 1: Write the failing test** (agregar caso a `lib/env.test.ts`)

```ts
// agregar dentro de lib/env.test.ts
import { it, expect } from 'vitest'
import { parseEnv } from '@/lib/env'

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a',
  SUPABASE_SERVICE_ROLE_KEY: 'b',
  JINA_API_KEY: 'c',
  QDRANT_URL: 'https://q.cloud',
  QDRANT_API_KEY: 'd',
  OPENAI_API_KEY: 'sk-test',
}

it('requiere OPENAI_API_KEY', () => {
  expect(() => parseEnv({ ...valid, OPENAI_API_KEY: undefined })).toThrow()
  expect(parseEnv(valid).OPENAI_API_KEY).toBe('sk-test')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/env`
Expected: FAIL (`OPENAI_API_KEY` no está en el schema).

- [ ] **Step 3: Agregar al schema en `lib/env.ts`**

En el objeto `z.object({ ... })`, agregar la línea:

```ts
  OPENAI_API_KEY: z.string().min(1),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/env`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/env.ts lib/env.test.ts
git commit -m "feat(env): requerir OPENAI_API_KEY"
```

---

## Task 5: Umbral de confianza de clasificación (lib/classify, lógica pura)

**Files:**
- Create: `lib/classify/index.ts`
- Create: `lib/classify/fake.ts`
- Test: `lib/classify/threshold.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/classify/threshold.test.ts
import { describe, it, expect } from 'vitest'
import { applyThreshold, type FacetPrediction } from '@/lib/classify'

const preds: FacetPrediction[] = [
  { category: 'board_type', value: 'longboard', confidence: 0.95 },
  { category: 'stance', value: 'goofy', confidence: 0.5 },   // bajo umbral
  { category: 'sexo', value: 'hombre', confidence: 0.8 },
  { category: 'board_type', value: 'inventado', confidence: 0.99 }, // fuera de vocabulario
]

describe('applyThreshold', () => {
  it('asigna solo facetas válidas y por encima del umbral', () => {
    expect(applyThreshold(preds, 0.7)).toEqual({ board_type: 'longboard', sexo: 'hombre' })
  })
  it('si todo está por debajo del umbral devuelve objeto vacío (todo null)', () => {
    expect(applyThreshold([{ category: 'stance', value: 'goofy', confidence: 0.3 }], 0.7)).toEqual({})
  })
  it('ante dos predicciones de la misma categoría, gana la de mayor confianza', () => {
    const out = applyThreshold([
      { category: 'maneuver', value: 'cutback', confidence: 0.75 },
      { category: 'maneuver', value: 'floater', confidence: 0.9 },
    ], 0.7)
    expect(out).toEqual({ maneuver: 'floater' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/classify`
Expected: FAIL ("Cannot find module '@/lib/classify'").

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/classify/index.ts
import { isValidFacet, type FacetCategory } from '@/lib/facets'
import type { PhotoFacets } from '@/lib/vectors'

export type FacetPrediction = { category: string; value: string; confidence: number }

export interface Classifier {
  classify(image: Buffer): Promise<FacetPrediction[]>
}

export const CONFIDENCE_THRESHOLD = 0.7

// Blindaje: solo se asigna una faceta válida cuya confianza supere el umbral.
// Ante empate de categoría, gana la mayor confianza. El resto queda null (no aparece).
export function applyThreshold(preds: FacetPrediction[], threshold = CONFIDENCE_THRESHOLD): PhotoFacets {
  const best: Record<string, FacetPrediction> = {}
  for (const p of preds) {
    if (p.confidence < threshold) continue
    if (!isValidFacet(p.category, p.value)) continue
    const cur = best[p.category]
    if (!cur || p.confidence > cur.confidence) best[p.category] = p
  }
  const out: PhotoFacets = {}
  for (const [cat, p] of Object.entries(best)) out[cat as FacetCategory] = p.value
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/classify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/classify/index.ts lib/classify/threshold.test.ts
git commit -m "feat(classify): umbral de confianza para asignación de facetas"
```

---

## Task 6: Clasificador OpenAI (visión) + fake

**Files:**
- Modify: `lib/classify/index.ts` (agregar impl OpenAI)
- Create: `lib/classify/fake.ts`
- Modify: `package.json` (dependencia `openai`)

> Sin test unitario nuevo: la impl real hace I/O contra OpenAI (se verifica en vivo en Tarea 7/13). El fake habilita los tests del pipeline.

- [ ] **Step 1: Instalar el SDK de OpenAI**

Run: `npm install openai`
Expected: agrega `openai` a `dependencies`.

- [ ] **Step 2: Crear el fake**

```ts
// lib/classify/fake.ts
import type { Classifier, FacetPrediction } from './index'

export class FakeClassifier implements Classifier {
  calls: number[] = []
  constructor(private preds: FacetPrediction[] = [
    { category: 'board_type', value: 'longboard', confidence: 0.95 },
  ]) {}
  async classify(image: Buffer): Promise<FacetPrediction[]> {
    this.calls.push(image.length)
    return this.preds
  }
}
```

- [ ] **Step 3: Agregar la impl OpenAI a `lib/classify/index.ts`**

Agregar al final del archivo:

```ts
import OpenAI from 'openai'
import { env } from '@/lib/env'
import { FACET_VOCAB, FACET_CATEGORIES } from '@/lib/facets'

// Prompt estático: describe el vocabulario permitido por categoría.
const VOCAB_DESC = FACET_CATEGORIES
  .map((c) => `- ${c}: ${FACET_VOCAB[c].join(', ')}`)
  .join('\n')

const SYSTEM = `Sos un clasificador de fotos de surf. Mirá la imagen y, SOLO si estás seguro, \
asigná facetas usando EXCLUSIVAMENTE estos valores:\n${VOCAB_DESC}\n\
Reglas: una sola faceta por categoría; si dudás, NO la incluyas (confidence baja). \
'patas_de_rana' es si/no según se vean. 'stance' es goofy (pie derecho adelante) o regular (izquierdo). \
Devolvé un array 'facets' con {category, value, confidence} (confidence 0..1).`

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    facets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', enum: FACET_CATEGORIES },
          value: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['category', 'value', 'confidence'],
      },
    },
  },
  required: ['facets'],
} as const

export class OpenAIClassifier implements Classifier {
  private client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
  async classify(image: Buffer): Promise<FacetPrediction[]> {
    const res = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } },
        ] },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'facets', strict: true, schema: RESPONSE_SCHEMA },
      },
    })
    const raw = res.choices[0]?.message?.content
    if (!raw) return []
    const parsed = JSON.parse(raw) as { facets: FacetPrediction[] }
    return parsed.facets ?? []
  }
}

let singleton: Classifier | null = null
export function getClassifier(): Classifier {
  if (!singleton) singleton = new OpenAIClassifier()
  return singleton
}
```

- [ ] **Step 4: Verificar tests aislados de classify**

Run: `npm test -- lib/classify`
Expected: PASS.
> El type-check de proyecto completo se difiere a la Tarea 12 (el módulo de búsqueda está en transición).

- [ ] **Step 5: Commit**

```bash
git add lib/classify/index.ts lib/classify/fake.ts package.json package-lock.json
git commit -m "feat(classify): clasificador OpenAI visión + fake"
```

---

## Task 7: Wire auto-clasificación al pipeline processPhoto

**Files:**
- Modify: `lib/photos/types.ts`
- Modify: `lib/photos/process.ts`
- Modify: `lib/photos/process.test.ts`
- Modify: `app/api/photos/[id]/process/route.ts`

- [ ] **Step 1: Write the failing test** (agregar a `lib/photos/process.test.ts`)

```ts
// agregar a lib/photos/process.test.ts
import { describe, it, expect, vi } from 'vitest'
import { processPhoto } from '@/lib/photos/process'

function baseDeps() {
  return {
    downloadOriginal: vi.fn(async () => Buffer.from('orig')),
    makePreview: vi.fn(async () => Buffer.from('prev')),
    makeThumb: vi.fn(async () => Buffer.from('thumb')),
    readDimensions: vi.fn(async () => ({ width: 100, height: 80 })),
    uploadPublic: vi.fn(async () => {}),
    embedImage: vi.fn(async () => new Array(4).fill(0.1)),
    indexVector: vi.fn(async () => {}),
    classifyFacets: vi.fn(async () => ({ board_type: 'longboard' })),
    indexFacets: vi.fn(async () => {}),
    updatePhoto: vi.fn(async () => {}),
  }
}

describe('processPhoto + facetas', () => {
  it('clasifica e indexa facetas tras un embedding exitoso', async () => {
    const deps = baseDeps()
    await processPhoto(deps, { id: 'p1', original_path: 'p1/orig.jpg' })
    expect(deps.classifyFacets).toHaveBeenCalledOnce()
    expect(deps.indexFacets).toHaveBeenCalledWith({ board_type: 'longboard' })
  })
  it('si la clasificación falla, la foto igual queda ready (best-effort)', async () => {
    const deps = baseDeps()
    deps.classifyFacets = vi.fn(async () => { throw new Error('openai down') })
    await processPhoto(deps, { id: 'p1', original_path: 'p1/orig.jpg' })
    // ready ya se seteó antes; no se relanza el error
    expect(deps.updatePhoto).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))
    expect(deps.indexFacets).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/photos/process`
Expected: FAIL (`classifyFacets`/`indexFacets` no existen en `ProcessDeps`).

- [ ] **Step 3: Extender `ProcessDeps` en `lib/photos/types.ts`**

Agregar al type `ProcessDeps` (después de `indexVector`):

```ts
  classifyFacets: (image: Buffer) => Promise<import('@/lib/vectors').PhotoFacets>
  indexFacets: (facets: import('@/lib/vectors').PhotoFacets) => Promise<void>
```

- [ ] **Step 4: Agregar el paso de clasificación en `lib/photos/process.ts`**

Reemplazar el bloque "Embedding best-effort" por:

```ts
  // Embedding + auto-clasificación de facetas, best-effort (no tumban el 'ready').
  try {
    const vector = await deps.embedImage(original)
    await deps.indexVector(vector)
    await deps.updatePhoto({ embedding_status: 'done' })
  } catch {
    await deps.updatePhoto({ embedding_status: 'failed' })
  }

  try {
    const facets = await deps.classifyFacets(original)
    await deps.indexFacets(facets)
  } catch {
    // clasificación best-effort: la foto queda sin facetas (null → no excluye en búsqueda)
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- lib/photos/process`
Expected: PASS.

- [ ] **Step 6: Wire en el route handler `app/api/photos/[id]/process/route.ts`**

Agregar imports arriba:

```ts
import { upsertPhoto, setPhotoFacetsPayload, type PhotoFacets } from '@/lib/vectors'
import { getClassifier, applyThreshold } from '@/lib/classify'
```

(quitar el import viejo de `upsertPhoto`). En la llamada a `processPhoto`, cambiar `tags: []` por `facets: {}` dentro de `indexVector`, y agregar las dos deps nuevas. Reemplazar el objeto deps `indexVector`/`updatePhoto` por:

```ts
      indexVector: (vector: number[]) =>
        upsertPhoto(vector, {
          id: photo.id,
          photographer_id: photo.photographer_id,
          beach_slug: beach?.slug ?? '',
          captured_at: photo.captured_at,
          time_block: photo.time_block,
          facets: {},
          status: 'ready',
          session_id: photo.session_id,
        }),
      classifyFacets: async (img: Buffer): Promise<PhotoFacets> =>
        applyThreshold(await getClassifier().classify(img)),
      indexFacets: async (facets: PhotoFacets) => {
        // Persistir en Postgres (upsert por categoría) + sincronizar payload de Qdrant.
        const rows = Object.entries(facets).map(([category, value]) => ({
          photo_id: photo.id, category, value,
        }))
        if (rows.length) await admin.from('photo_facets').upsert(rows, { onConflict: 'photo_id,category' })
        await setPhotoFacetsPayload(photo.id, facets)
      },
      updatePhoto: async (patch: Record<string, unknown>) => {
        await admin.from('photos').update(patch).eq('id', id)
      },
```

- [ ] **Step 7: Verificar tests del pipeline**

Run: `npm test -- lib/photos/process`
Expected: PASS.
> El route handler `process/route.ts` compila contra el nuevo `lib/vectors`/`lib/classify`; el type-check de proyecto completo (que aún ve `execute.ts` viejo) se difiere a la Tarea 12.

- [ ] **Step 8: Commit**

```bash
git add lib/photos/types.ts lib/photos/process.ts lib/photos/process.test.ts "app/api/photos/[id]/process/route.ts"
git commit -m "feat(pipeline): auto-clasificación de facetas en processPhoto"
```

> **Checkpoint:** aplicar la migración 0005 en vivo y correr el backfill (Tarea 13) deja la auto-clasificación funcionando end-to-end. La búsqueda (Tareas 8–12) la consume.

---

## Task 8: Rerank heurístico (lógica pura)

**Files:**
- Create: `lib/search/rerank.ts`
- Test: `lib/search/rerank.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/search/rerank.test.ts
import { describe, it, expect } from 'vitest'
import { rerank, type RerankItem } from '@/lib/search/rerank'

const items: RerankItem[] = [
  { id: 'a', vectorScore: 0.50, capturedAt: 100, voteCount: 0 },
  { id: 'b', vectorScore: 0.48, capturedAt: 200, voteCount: 50 }, // más nueva y votada
  { id: 'c', vectorScore: 0.30, capturedAt: 50, voteCount: 0 },
]

describe('rerank', () => {
  it('ordena por score combinado descendente', () => {
    const out = rerank(items)
    expect(out[0].id).toBe('b') // los boosts de recencia+votos la suben por encima de "a"
    expect(out[out.length - 1].id).toBe('c')
  })
  it('con boosts en cero, respeta el score del vector', () => {
    const out = rerank(items, { recencyWeight: 0, votesWeight: 0 })
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
  it('no muta el array de entrada', () => {
    const copy = [...items]
    rerank(items)
    expect(items).toEqual(copy)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/search/rerank`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/search/rerank.ts
export type RerankItem = {
  id: string
  vectorScore: number
  capturedAt: number // epoch segundos
  voteCount: number
}

export type RerankOptions = { recencyWeight?: number; votesWeight?: number }

// score_final = vectorScore + recencyWeight*recencyNorm + votesWeight*votesNorm
// Las normalizaciones son min-max dentro del set para que los boosts sean comparables.
export function rerank(items: RerankItem[], opts: RerankOptions = {}): RerankItem[] {
  const recencyWeight = opts.recencyWeight ?? 0.05
  const votesWeight = opts.votesWeight ?? 0.05
  if (items.length === 0) return []

  const norm = (vals: number[]) => {
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const span = max - min
    return (v: number) => (span === 0 ? 0 : (v - min) / span)
  }
  const recNorm = norm(items.map((i) => i.capturedAt))
  const voteNorm = norm(items.map((i) => i.voteCount))

  return [...items]
    .map((i) => ({
      item: i,
      score: i.vectorScore + recencyWeight * recNorm(i.capturedAt) + votesWeight * voteNorm(i.voteCount),
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/search/rerank`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/search/rerank.ts lib/search/rerank.test.ts
git commit -m "feat(search): rerank heurístico (vector + recencia + votos)"
```

---

## Task 9: Tipos de búsqueda + understand (interface + fake)

**Files:**
- Modify: `lib/search/types.ts`
- Create: `lib/search/understand.fake.ts`

> La impl real OpenAI va en la Tarea 10. Acá quedan los tipos y el fake para testear el pipeline.

- [ ] **Step 1: Extender `lib/search/types.ts`** (reemplazar el contenido)

```ts
// lib/search/types.ts
import type { FacetCategory } from '@/lib/facets'

export type ParsedFilters = {
  beach_slug?: string
  timeBlock?: string[]
  from?: string // ISO yyyy-mm-dd
  to?: string
  facets?: Partial<Record<FacetCategory, string[]>>
}

export type QueryUnderstanding = {
  filters: ParsedFilters
  visualQuery: string // texto para CLIP (color, vestimenta, apariencia)
}

export type UnderstandContext = {
  beaches: { slug: string; name: string }[]
  today: string // ISO yyyy-mm-dd
}

export interface QueryUnderstander {
  understand(raw: string, ctx: UnderstandContext): Promise<QueryUnderstanding>
}

export type PhotoResult = {
  id: string
  thumbUrl: string
  previewUrl: string
  price: number | null
  photographerSlug: string
  voteCount: number
  width: number | null
  height: number | null
}
```

- [ ] **Step 2: Crear el fake**

```ts
// lib/search/understand.fake.ts
import type { QueryUnderstander, QueryUnderstanding } from './types'

export class FakeUnderstander implements QueryUnderstander {
  calls: string[] = []
  constructor(private result: QueryUnderstanding = { filters: {}, visualQuery: '' }) {}
  async understand(raw: string): Promise<QueryUnderstanding> {
    this.calls.push(raw)
    return this.result
  }
}
```

- [ ] **Step 3: Verificar compilación**

Run: `npx tsc --noEmit`
Expected: errores esperados SOLO en `route.ts`/`execute.ts`/`buscar/page.tsx` (se arreglan en Tareas 11–12). Si hay errores en otros archivos, corregir antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add lib/search/types.ts lib/search/understand.fake.ts
git commit -m "feat(search): tipos de entendimiento de query + understander fake"
```

---

## Task 10: Understander OpenAI (NL → filtros + queryVisual) con fallback

**Files:**
- Create: `lib/search/understand.ts`

> I/O contra OpenAI; se verifica en vivo (Tarea 13). El fallback se ejercita en el test del pipeline (Tarea 11).

- [ ] **Step 1: Implementar**

```ts
// lib/search/understand.ts
import OpenAI from 'openai'
import { env } from '@/lib/env'
import { FACET_VOCAB, FACET_CATEGORIES } from '@/lib/facets'
import type { QueryUnderstander, QueryUnderstanding, UnderstandContext } from './types'

const TIME_BLOCKS = ['dawn', 'morning', 'midday', 'afternoon', 'sunset']

const FACET_PROPS = Object.fromEntries(
  FACET_CATEGORIES.map((c) => [c, { type: 'array', items: { type: 'string', enum: FACET_VOCAB[c] } }])
)

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    beach_slug: { type: ['string', 'null'] },
    timeBlock: { type: 'array', items: { type: 'string', enum: TIME_BLOCKS } },
    from: { type: ['string', 'null'] },
    to: { type: ['string', 'null'] },
    facets: { type: 'object', additionalProperties: false, properties: FACET_PROPS, required: [] },
    visualQuery: { type: 'string' },
  },
  required: ['visualQuery'],
} as const

function systemPrompt(ctx: UnderstandContext): string {
  const beaches = ctx.beaches.map((b) => `${b.name} → ${b.slug}`).join('; ')
  return `Sos el motor de búsqueda de fotos de surf Spoteado. Hoy es ${ctx.today}. \
Convertí la frase del surfista en filtros estructurados + una query visual.\n\
- Playas conocidas (nombre → slug): ${beaches}. Mapeá menciones al slug; si no reconocés, dejá null.\n\
- Fechas relativas ("el finde pasado", "ayer") → rango from/to ISO usando hoy.\n\
- timeBlock: ${TIME_BLOCKS.join(', ')} (mañana=morning, mediodía=midday, tarde=afternoon, atardecer=sunset, amanecer=dawn).\n\
- facets: usá SOLO los valores enum permitidos.\n\
- visualQuery: traducí a inglés SOLO lo visual que no es filtro (color de tabla/traje, vestimenta como "shirtless", apariencia). Si no hay nada visual, "".`
}

export class OpenAIUnderstander implements QueryUnderstander {
  private client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
  async understand(raw: string, ctx: UnderstandContext): Promise<QueryUnderstanding> {
    const res = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt(ctx) },
        { role: 'user', content: raw },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'query', strict: true, schema: SCHEMA } },
    })
    const content = res.choices[0]?.message?.content
    if (!content) throw new Error('understander: respuesta vacía')
    const j = JSON.parse(content)
    const facets: QueryUnderstanding['filters']['facets'] = {}
    for (const c of FACET_CATEGORIES) if (j.facets?.[c]?.length) facets[c] = j.facets[c]
    return {
      filters: {
        beach_slug: j.beach_slug ?? undefined,
        timeBlock: j.timeBlock?.length ? j.timeBlock : undefined,
        from: j.from ?? undefined,
        to: j.to ?? undefined,
        facets: Object.keys(facets).length ? facets : undefined,
      },
      visualQuery: j.visualQuery ?? '',
    }
  }
}

let singleton: QueryUnderstander | null = null
export function getUnderstander(): QueryUnderstander {
  if (!singleton) singleton = new OpenAIUnderstander()
  return singleton
}
```

- [ ] **Step 2: Verificar que el archivo es sintácticamente válido (sin tocar el resto)**

Run: `npx tsc --noEmit lib/search/understand.ts lib/search/types.ts lib/facets/index.ts 2>&1 | head -20`
Expected: sin errores en `understand.ts` (puede haber ruido por flags de proyecto; el type-check completo es la Tarea 12).

- [ ] **Step 3: Commit**

```bash
git add lib/search/understand.ts
git commit -m "feat(search): understander OpenAI NL→filtros+queryVisual"
```

---

## Task 11: Pipeline de búsqueda unificado (route.ts + execute.ts)

**Files:**
- Modify: `lib/search/route.ts`
- Modify: `lib/search/route.test.ts`
- Modify: `lib/search/execute.ts`
- Modify: `lib/search/execute.test.ts`

- [ ] **Step 1: Reescribir `lib/search/route.ts`**

`route.ts` ahora solo convierte `ParsedFilters` (ya resueltos por el LLM o por el panel manual) en `SearchFilter` de Qdrant.

```ts
// lib/search/route.ts
import type { ParsedFilters } from './types'
import type { SearchFilter } from '@/lib/vectors'

export function buildVectorFilter(f: ParsedFilters): SearchFilter {
  return {
    beach_slug: f.beach_slug,
    time_block: f.timeBlock,
    facets: f.facets,
    capturedFrom: f.from ? Math.floor(Date.parse(`${f.from}T00:00:00Z`) / 1000) : undefined,
    capturedTo: f.to ? Math.floor(Date.parse(`${f.to}T23:59:59Z`) / 1000) : undefined,
  }
}
```

- [ ] **Step 2: Reescribir `lib/search/route.test.ts`**

```ts
// lib/search/route.test.ts
import { describe, it, expect } from 'vitest'
import { buildVectorFilter } from '@/lib/search/route'

describe('buildVectorFilter', () => {
  it('convierte fechas a epoch segundos y pasa facetas/timeBlock', () => {
    const f = buildVectorFilter({
      beach_slug: 'mdp', from: '2026-05-24', to: '2026-05-24',
      timeBlock: ['afternoon'], facets: { board_type: ['longboard'] },
    })
    expect(f.beach_slug).toBe('mdp')
    expect(f.time_block).toEqual(['afternoon'])
    expect(f.facets).toEqual({ board_type: ['longboard'] })
    expect(f.capturedFrom).toBe(Math.floor(Date.parse('2026-05-24T00:00:00Z') / 1000))
    expect(f.capturedTo).toBe(Math.floor(Date.parse('2026-05-24T23:59:59Z') / 1000))
  })
})
```

- [ ] **Step 3: Reescribir `lib/search/execute.ts`**

```ts
// lib/search/execute.ts
import type { ParsedFilters, PhotoResult, QueryUnderstanding } from './types'
import { buildVectorFilter } from './route'
import { rerank, type RerankItem } from './rerank'
import type { SearchFilter } from '@/lib/vectors'

export const SCORE_THRESHOLD = 0.2

export type SearchDeps = {
  embedText: (q: string) => Promise<number[]>
  vectorSearch: (vector: number[], filter: SearchFilter) => Promise<{ id: string; score: number }[]>
  fetchByFilters: (filter: SearchFilter) => Promise<RerankItem[]>
  fetchResults: (ids: string[]) => Promise<PhotoResult[]>
}

// Combina filtros parseados por el LLM con los del panel manual (el manual pisa/añade).
export function mergeFilters(llm: ParsedFilters, manual: ParsedFilters): ParsedFilters {
  return {
    beach_slug: manual.beach_slug ?? llm.beach_slug,
    timeBlock: manual.timeBlock ?? llm.timeBlock,
    from: manual.from ?? llm.from,
    to: manual.to ?? llm.to,
    facets: { ...(llm.facets ?? {}), ...(manual.facets ?? {}) },
  }
}

export async function runSearch(
  deps: SearchDeps,
  understanding: QueryUnderstanding,
  manual: ParsedFilters
): Promise<PhotoResult[]> {
  const filters = mergeFilters(understanding.filters, manual)
  const qFilter = buildVectorFilter(filters)
  const visual = understanding.visualQuery.trim()

  // Sin texto visual → filtro puro ordenado por recencia (sin vector).
  if (!visual) {
    const rows = await deps.fetchByFilters(qFilter)
    const ordered = rerank(rows, { recencyWeight: 1, votesWeight: 0.1 })
    return deps.fetchResults(ordered.map((r) => r.id))
  }

  // Con texto visual → vector search filtrado + rerank.
  const vector = await deps.embedText(visual)
  const hits = (await deps.vectorSearch(vector, qFilter)).filter((h) => h.score >= SCORE_THRESHOLD)
  if (hits.length === 0) return []

  const meta = new Map((await deps.fetchByFilters(qFilter)).map((r) => [r.id, r]))
  const items: RerankItem[] = hits.map((h) => {
    const m = meta.get(h.id)
    return { id: h.id, vectorScore: h.score, capturedAt: m?.capturedAt ?? 0, voteCount: m?.voteCount ?? 0 }
  })
  const ordered = rerank(items)
  return deps.fetchResults(ordered.map((r) => r.id))
}
```

- [ ] **Step 4: Reescribir `lib/search/execute.test.ts`**

```ts
// lib/search/execute.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runSearch, mergeFilters, type SearchDeps } from '@/lib/search/execute'
import type { PhotoResult } from '@/lib/search/types'

const result = (id: string): PhotoResult => ({
  id, thumbUrl: '', previewUrl: '', price: null, photographerSlug: 'u', voteCount: 0, width: null, height: null,
})

describe('mergeFilters', () => {
  it('el panel manual pisa el beach del LLM y une facetas', () => {
    const out = mergeFilters(
      { beach_slug: 'a', facets: { board_type: ['longboard'] } },
      { beach_slug: 'b', facets: { sexo: ['mujer'] } }
    )
    expect(out.beach_slug).toBe('b')
    expect(out.facets).toEqual({ board_type: ['longboard'], sexo: ['mujer'] })
  })
})

describe('runSearch', () => {
  it('sin queryVisual usa filtros puros (no embebe)', async () => {
    const deps: SearchDeps = {
      embedText: vi.fn(),
      vectorSearch: vi.fn(),
      fetchByFilters: vi.fn(async () => [{ id: 'x', vectorScore: 0, capturedAt: 10, voteCount: 0 }]),
      fetchResults: vi.fn(async (ids) => ids.map(result)),
    }
    const out = await runSearch(deps, { filters: {}, visualQuery: '' }, {})
    expect(deps.embedText).not.toHaveBeenCalled()
    expect(out.map((r) => r.id)).toEqual(['x'])
  })

  it('con queryVisual embebe, filtra por umbral y rerankea', async () => {
    const deps: SearchDeps = {
      embedText: vi.fn(async () => [0.1, 0.2]),
      vectorSearch: vi.fn(async () => [{ id: 'a', score: 0.5 }, { id: 'b', score: 0.1 }]), // b bajo umbral
      fetchByFilters: vi.fn(async () => [{ id: 'a', vectorScore: 0, capturedAt: 1, voteCount: 0 }]),
      fetchResults: vi.fn(async (ids) => ids.map(result)),
    }
    const out = await runSearch(deps, { filters: {}, visualQuery: 'blue longboard' }, {})
    expect(deps.embedText).toHaveBeenCalledWith('blue longboard')
    expect(out.map((r) => r.id)).toEqual(['a'])
  })

  it('devuelve vacío si ningún hit supera el umbral', async () => {
    const deps: SearchDeps = {
      embedText: vi.fn(async () => [0.1]),
      vectorSearch: vi.fn(async () => [{ id: 'a', score: 0.05 }]),
      fetchByFilters: vi.fn(async () => []),
      fetchResults: vi.fn(async (ids) => ids.map(result)),
    }
    const out = await runSearch(deps, { filters: {}, visualQuery: 'x' }, {})
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- lib/search`
Expected: PASS (route, execute, rerank).

- [ ] **Step 6: Commit**

```bash
git add lib/search/route.ts lib/search/route.test.ts lib/search/execute.ts lib/search/execute.test.ts
git commit -m "feat(search): pipeline unificado (merge filtros + vector + rerank)"
```

---

## Task 12: Wire de la página de búsqueda + UI

**Files:**
- Modify: `app/(public)/buscar/page.tsx`
- Modify: `components/search/search-bar.tsx`

- [ ] **Step 1: Reescribir `app/(public)/buscar/page.tsx`**

```tsx
// app/(public)/buscar/page.tsx
import { createClient } from '@/lib/supabase/server'
import { getEmbedder } from '@/lib/embeddings'
import { getUnderstander } from '@/lib/search/understand'
import { searchPhotos, scrollPhotos, type SearchFilter } from '@/lib/vectors'
import { runSearch, type SearchDeps } from '@/lib/search/execute'
import type { PhotoResult, ParsedFilters, QueryUnderstanding } from '@/lib/search/types'
import { FACET_CATEGORIES, type FacetCategory } from '@/lib/facets'
import { previewUrl, thumbUrl } from '@/lib/photos/public-url'
import { Masonry } from '@/components/photo/masonry'
import type { RerankItem } from '@/lib/search/rerank'

type Row = { id: string; price: number | null; vote_count: number; width: number | null; height: number | null; photographer_id: string; captured_at: string }

function toResult(r: Row): PhotoResult {
  return {
    id: r.id, thumbUrl: thumbUrl(r.id), previewUrl: previewUrl(r.id),
    price: r.price, photographerSlug: r.photographer_id, voteCount: r.vote_count,
    width: r.width, height: r.height,
  }
}

// Lee los filtros del panel manual desde el query string (CSV por categoría).
function parseManualFilters(raw: Record<string, string | undefined>): ParsedFilters {
  const csv = (v?: string) => (v && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)
  const facets: Partial<Record<FacetCategory, string[]>> = {}
  for (const c of FACET_CATEGORIES) { const vals = csv(raw[c]); if (vals) facets[c] = vals }
  return {
    beach_slug: raw.beach?.trim() || undefined,
    timeBlock: csv(raw.timeBlock),
    from: raw.from?.trim() || undefined,
    to: raw.to?.trim() || undefined,
    facets: Object.keys(facets).length ? facets : undefined,
  }
}

export default async function BuscarPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams
  const supabase = await createClient()
  const select = 'id, price, vote_count, width, height, photographer_id, captured_at'
  const q = raw.q?.trim() ?? ''
  const manual = parseManualFilters(raw)

  // Capa de entendimiento (con fallback robusto: si el LLM falla, va CLIP sobre el texto crudo).
  let understanding: QueryUnderstanding = { filters: {}, visualQuery: q }
  if (q) {
    try {
      const { data: beaches } = await supabase.from('beaches').select('slug, name')
      understanding = await getUnderstander().understand(q, {
        beaches: beaches ?? [],
        today: new Date().toISOString().slice(0, 10),
      })
    } catch {
      understanding = { filters: {}, visualQuery: q }
    }
  }

  const fetchByFilters = async (filter: SearchFilter): Promise<RerankItem[]> => {
    // Todo el filtro (beach + fecha + facetas, con "vacío no excluye") vive en el payload de
    // Qdrant: scroll trae los IDs que matchean; Postgres aporta captured_at + vote_count.
    // Nota: solo aparecen fotos con embedding indexado (las de embedding_status='failed' quedan fuera).
    const ids = await scrollPhotos(filter, 60)
    if (ids.length === 0) return []
    const { data } = await supabase.from('photos').select('id, vote_count, captured_at').in('id', ids)
    return (data ?? []).map((r) => ({
      id: r.id, vectorScore: 0,
      capturedAt: Math.floor(Date.parse(r.captured_at) / 1000), voteCount: r.vote_count,
    }))
  }

  const deps: SearchDeps = {
    embedText: (text) => getEmbedder().embedText(text),
    vectorSearch: (vector, filter) => searchPhotos(vector, filter),
    fetchByFilters,
    fetchResults: async (ids) => {
      if (ids.length === 0) return []
      const { data } = await supabase.from('photos').select(select).in('id', ids)
      const byId = new Map((data ?? []).map((r) => [r.id, toResult(r as Row)]))
      return ids.map((id) => byId.get(id)).filter((r): r is PhotoResult => Boolean(r)) // preserva orden del rerank
    },
  }

  const results = await runSearch(deps, understanding, manual)

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <p className="text-sm text-ink/60">{results.length} fotos</p>
      {results.length === 0 ? (
        <p className="py-12 text-center text-ink/50">
          No encontramos fotos con eso — probá sacar un filtro o describilo distinto.
        </p>
      ) : (
        <Masonry photos={results} />
      )}
    </main>
  )
}
```

- [ ] **Step 2: Type-check de proyecto completo (primer gate global)**

Ahora que todo el módulo de búsqueda quedó consistente (`vectors`, `facets`, `rerank`, `understand`, `types`, `route`, `execute`, `process route`, página), recién acá corre el type-check completo.

Run: `npx tsc --noEmit`
Expected: sin errores. Si aparece algún import sin uso o desajuste de tipos, corregirlo antes de seguir.

- [ ] **Step 3: Reescribir `components/search/search-bar.tsx`** (caja NL protagonista + panel de filtros plegable)

```tsx
// components/search/search-bar.tsx
'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const FILTER_GROUPS: { category: string; label: string; values: { value: string; label: string }[] }[] = [
  { category: 'board_type', label: 'Tabla', values: [
    { value: 'longboard', label: 'Longboard' }, { value: 'tabla-corta', label: 'Tabla corta' },
    { value: 'fish', label: 'Fish' }, { value: 'evolutiva', label: 'Evolutiva' }, { value: 'gun', label: 'Gun' },
    { value: 'espuma', label: 'Espuma' }, { value: 'sup', label: 'SUP' }, { value: 'bodyboard', label: 'Bodyboard' },
    { value: 'bodysurf', label: 'Bodysurf' },
  ] },
  { category: 'stance', label: 'Stance', values: [{ value: 'goofy', label: 'Goofy' }, { value: 'regular', label: 'Regular' }] },
  { category: 'sexo', label: 'Surfista', values: [{ value: 'hombre', label: 'Hombre' }, { value: 'mujer', label: 'Mujer' }] },
  { category: 'patas_de_rana', label: 'Patas de rana', values: [{ value: 'si', label: 'Con' }, { value: 'no', label: 'Sin' }] },
]

export function SearchBar({ beaches }: { beaches: { slug: string; name: string }[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [beach, setBeach] = useState('')
  const [date, setDate] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<Record<string, string[]>>({})

  function toggle(category: string, value: string) {
    setSel((s) => {
      const cur = s[category] ?? []
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
      return { ...s, [category]: next }
    })
  }

  function go() {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (beach) params.set('beach', beach)
    if (date) { params.set('from', date); params.set('to', date) }
    for (const [cat, vals] of Object.entries(sel)) if (vals.length) params.set(cat, vals.join(','))
    router.push(`/buscar?${params.toString()}`)
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-3 bg-canvas/95 p-4">
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="describí tu sesión: dónde, cuándo, cómo ibas…"
        className="border-b border-ink/15 bg-transparent py-2 text-lg"
      />
      <button onClick={() => setOpen((o) => !o)} className="self-start text-sm text-ink/60 underline">
        {open ? 'Ocultar filtros' : 'Filtros'}
      </button>
      {open && (
        <div className="flex flex-col gap-3">
          <select value={beach} onChange={(e) => setBeach(e.target.value)} className="border-b border-ink/15 bg-transparent py-2">
            <option value="">Playa</option>
            {beaches.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border-b border-ink/15 bg-transparent py-2" />
          {FILTER_GROUPS.map((g) => (
            <div key={g.category} className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-ink/40">{g.label}</span>
              <div className="flex flex-wrap gap-2">
                {g.values.map((v) => {
                  const active = (sel[g.category] ?? []).includes(v.value)
                  return (
                    <button
                      key={v.value} onClick={() => toggle(g.category, v.value)}
                      className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-accent bg-accent text-canvas' : 'border-ink/20 text-ink/70'}`}
                    >{v.label}</button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <button onClick={go} className="rounded-sm bg-accent px-4 py-2 text-canvas">Buscar</button>
    </div>
  )
}
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build OK (sin errores de tipo ni de Next).

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/buscar/page.tsx" components/search/search-bar.tsx
git commit -m "feat(search): página unificada (LLM+CLIP+rerank) + UI caja NL + filtros"
```

---

## Task 13: Backfill + verificación en vivo

**Files:**
- Create: `scripts/backfill-facets.mjs`

> La limpieza del sistema de tags ya se hizo en la Tarea 3. Acá se aplica la migración en vivo, se re-clasifican las fotos existentes y se verifica end-to-end.

- [ ] **Step 1: Aplicar la migración 0005 en vivo**

Aplicar `supabase/migrations/0005_facets.sql` contra la DB del proyecto (mismo método usado en Fases 0–2). Verificar que `facet_values` quedó con 26 filas y que `photo_tags`/`tags` ya no existen.

- [ ] **Step 2: Crear el script de backfill**

```js
// scripts/backfill-facets.mjs
// Re-procesa fotos ready ya cargadas: auto-clasifica facetas + re-indexa payload.
// Uso: node --env-file=.env.local scripts/backfill-facets.mjs
import { createClient } from '@supabase/supabase-js'
import { getClassifier, applyThreshold } from '../lib/classify/index.ts'
import { ensureCollection, setPhotoFacetsPayload } from '../lib/vectors/index.ts'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

await ensureCollection() // crea los índices de payload nuevos (board_type, stance, etc.)

const { data: photos } = await admin
  .from('photos').select('id, original_path').eq('status', 'ready').eq('embedding_status', 'done')

console.log(`Backfilling ${photos?.length ?? 0} fotos`)
for (const photo of photos ?? []) {
  const { data: blob } = await admin.storage.from('originals').download(photo.original_path)
  const buf = Buffer.from(await blob.arrayBuffer())
  const facets = applyThreshold(await getClassifier().classify(buf))
  const rows = Object.entries(facets).map(([category, value]) => ({ photo_id: photo.id, category, value }))
  if (rows.length) await admin.from('photo_facets').upsert(rows, { onConflict: 'photo_id,category' })
  await setPhotoFacetsPayload(photo.id, facets)
  console.log(`  ${photo.id}: ${JSON.stringify(facets)}`)
}
console.log('Listo.')
```

> Si el runtime no importa `.ts` directo, transpilar con `npx tsx` en vez de `node`: `npx tsx --env-file=.env.local scripts/backfill-facets.mjs`.

- [ ] **Step 3: Correr el backfill y verificar en vivo**

Run: `node --env-file=.env.local scripts/backfill-facets.mjs` (o `npx tsx ...`).
Expected: imprime las facetas asignadas por foto. Verificar en Qdrant que el payload tiene las facetas y en `photo_facets` las filas.

- [ ] **Step 4: Verificación end-to-end de búsqueda**

Probar dos búsquedas reales en `/buscar`:
1. Filtro puro: `?beach=<slug>&board_type=longboard` → trae longboards de esa playa (y fotos sin board_type asignado, por "vacío no excluye").
2. Lenguaje natural: `?q=longboard azul a la tarde` → el LLM rutea filtros + queryVisual, CLIP ordena.

Confirmar que ambos devuelven resultados coherentes. Borrar `scripts/backfill-facets.mjs` si fue de un solo uso (o dejarlo documentado).

- [ ] **Step 5: Commit final**

```bash
git add scripts/backfill-facets.mjs
git commit -m "chore(search): script de backfill de facetas + verificación en vivo"
```

---

## Notas de implementación

- **Modelos OpenAI:** `gpt-4o` para visión (clasificación, precisión) y `gpt-4o-mini` para entendimiento de query (rápido/barato). Ajustar versión exacta si hay una más nueva al implementar.
- **Fallback del understander:** la página ya envuelve `understand()` en try/catch → si OpenAI falla, busca con CLIP sobre el texto crudo. La búsqueda nunca se cae por el LLM.
- **"Vacío no excluye":** implementado en `buildSearchFilter` con `should: [match, is_empty]` por categoría. Es la regla que evita perder la foto del surfista cuando la IA no clasificó con confianza.
- **Setup del usuario:** agregar `OPENAI_API_KEY` a `.env.local` antes de la verificación en vivo (Tareas 7/13). MercadoPago sigue postergado.
