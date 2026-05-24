# Fase 1 — Carga + Catálogo (fotógrafo): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Depende de:** Fase 0 (auth, roles, env, sistema visual, Supabase clients).

**Goal:** Un fotógrafo crea sesiones, sube fotos (subida directa a Storage), y cada foto se procesa en paralelo (watermark + thumbnail + embedding CLIP + indexado en Qdrant) y queda gestionable (precios, tags, pack).

**Architecture:** Subida directa del original al bucket privado vía signed upload URL. Por cada foto, una invocación corta e idempotente `processPhoto` (route handler) baja el original, genera preview con watermark + thumbnail (`sharp`), pide el embedding a una API CLIP hosteada, hace upsert del punto en Qdrant y actualiza la fila. Cada servicio externo está detrás de una interfaz (`lib/images`, `lib/embeddings`, `lib/vectors`) para testear la orquestación con fakes.

**Tech Stack:** Next.js 16, Supabase Storage + Postgres, `sharp`, `@qdrant/js-client-rest`, API de embeddings CLIP (default: Jina `jina-clip-v2`, 1024 dims), Vitest.

**Convenciones:** Route handlers `export async function POST(req, ctx)` con `ctx.params` async (`RouteContext<'/api/photos/[id]/process'>`). Service-role client solo en server.

---

## File Structure

```
supabase/migrations/0002_catalog.sql      beaches, sessions, photos, tags, photo_tags + RLS
supabase/migrations/0003_storage.sql       buckets originals (privado) + public + policies
lib/supabase/admin.ts                       client service-role (server only)
lib/images/index.ts                         watermarkPreview + makeThumbnail (sharp)
lib/images/index.test.ts
lib/embeddings/index.ts                     Embedder interface + JinaEmbedder + getEmbedder
lib/embeddings/fake.ts                      FakeEmbedder para tests
lib/vectors/index.ts                        Qdrant client + buildPayload + upsert/delete/search
lib/vectors/payload.test.ts
lib/photos/process.ts                       processPhoto(deps, photoId) — orquestación
lib/photos/process.test.ts
lib/photos/types.ts                         tipos compartidos (PhotoStatus, etc.)
app/api/photos/[id]/process/route.ts        dispara processPhoto
app/(dashboard)/_actions/upload.ts          signed upload URL + createPhotoRow (server actions)
app/(dashboard)/_actions/catalog.ts         createSession, setPrice, setTags, setPackPrice
app/(dashboard)/dashboard/subir/page.tsx     UI de carga
app/(dashboard)/dashboard/subir/uploader.tsx UI client del dropzone + estados
app/(dashboard)/dashboard/fotos/page.tsx     gestión de sesiones/fotos
.env.example                                 (agregar QDRANT_*, JINA_API_KEY)
```

---

## Task 1: Migración del catálogo + Storage

**Files:**
- Create: `supabase/migrations/0002_catalog.sql`
- Create: `supabase/migrations/0003_storage.sql`

- [ ] **Step 1: Escribir la migración del catálogo**

```sql
-- supabase/migrations/0002_catalog.sql
create type public.photo_status as enum ('processing', 'ready', 'failed');
create type public.embedding_status as enum ('pending', 'done', 'failed');
create type public.time_block as enum ('dawn', 'morning', 'midday', 'afternoon', 'sunset');

create table public.beaches (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  slug   text not null unique,
  region text
);

create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.profiles (id) on delete cascade,
  beach_id        uuid not null references public.beaches (id),
  session_date    date not null,
  time_block      public.time_block,
  title           text,
  pack_price      numeric(12,2),
  cover_photo_id  uuid,
  created_at      timestamptz not null default now()
);

create table public.photos (
  id               uuid primary key default gen_random_uuid(),
  photographer_id  uuid not null references public.profiles (id) on delete cascade,
  session_id       uuid references public.sessions (id) on delete set null,
  beach_id         uuid not null references public.beaches (id),
  captured_at      timestamptz not null,
  time_block       public.time_block,
  price            numeric(12,2),
  original_path    text not null,
  preview_path     text,
  thumb_path       text,
  width            int,
  height           int,
  status           public.photo_status not null default 'processing',
  embedding_status public.embedding_status not null default 'pending',
  vote_count       int not null default 0,
  contest_week     date,                      -- lunes de la semana de captured_at (Fase 4)
  created_at       timestamptz not null default now()
);
create index photos_beach_captured_idx on public.photos (beach_id, captured_at desc);

create table public.tags (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique
);
create table public.photo_tags (
  photo_id uuid references public.photos (id) on delete cascade,
  tag_id   uuid references public.tags (id) on delete cascade,
  primary key (photo_id, tag_id)
);

-- RLS
alter table public.beaches    enable row level security;
alter table public.sessions   enable row level security;
alter table public.photos     enable row level security;
alter table public.tags       enable row level security;
alter table public.photo_tags enable row level security;

-- Lectura pública de catálogo (browse). Las fotos solo si están ready.
create policy "beaches visibles"  on public.beaches    for select using (true);
create policy "tags visibles"     on public.tags        for select using (true);
create policy "phototags visibles" on public.photo_tags for select using (true);
create policy "sessions visibles" on public.sessions   for select using (true);
create policy "fotos ready visibles" on public.photos  for select
  using (status = 'ready' or photographer_id = auth.uid());

-- El fotógrafo gestiona lo suyo.
create policy "fotografo gestiona sus sessions" on public.sessions for all
  using (photographer_id = auth.uid()) with check (photographer_id = auth.uid());
create policy "fotografo gestiona sus fotos" on public.photos for all
  using (photographer_id = auth.uid()) with check (photographer_id = auth.uid());

-- Watermark del fotógrafo (lo usa el pipeline processPhoto de esta fase).
alter table public.profiles
  add column watermark_path     text,
  add column watermark_position text default 'bottom-right',
  add column watermark_opacity  numeric default 0.6;
```

- [ ] **Step 2: Escribir la migración de Storage**

```sql
-- supabase/migrations/0003_storage.sql
insert into storage.buckets (id, name, public) values ('originals', 'originals', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('public', 'public', true)
  on conflict (id) do nothing;

-- El fotógrafo sube/lee SUS originales (carpeta = su uid).
create policy "fotografo sube sus originales" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotografo lee sus originales" on storage.objects for select
  to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text);

-- Bucket público: lectura para todos, escritura autenticada.
create policy "public lee" on storage.objects for select
  using (bucket_id = 'public');
create policy "public escribe autenticado" on storage.objects for insert
  to authenticated with check (bucket_id = 'public');
```

- [ ] **Step 3: Aplicar y verificar**

Run: `npx supabase db push` (o pegar en SQL Editor).
Verificar en el Dashboard: tablas creadas con RLS, y buckets `originals` (privado) + `public` (público). Insertar una playa de prueba: `insert into beaches (name, slug, region) values ('Mar del Plata', 'mar-del-plata', 'Buenos Aires');`

- [ ] **Step 4: Commitear**

```bash
git add supabase/migrations/0002_catalog.sql supabase/migrations/0003_storage.sql
git commit -m "feat: migraciones de catálogo (beaches/sessions/photos/tags) + buckets"
```

---

## Task 2: Client Supabase service-role

**Files:**
- Create: `lib/supabase/admin.ts`
- Modify: `.env.example` (ya tiene SUPABASE_SERVICE_ROLE_KEY de Fase 0)

> Wiring; sin test de unidad.

- [ ] **Step 1: Implementar el admin client**

```ts
// lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

/** Client con service-role. SOLO server. Saltea RLS: usar con cuidado. */
export function createAdminClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/supabase/admin.ts
git commit -m "feat: client Supabase service-role (server only)"
```

---

## Task 3: Procesamiento de imágenes (`lib/images`) — TDD

**Files:**
- Create: `lib/images/index.ts`
- Create: `lib/images/index.test.ts`

- [ ] **Step 1: Instalar sharp**

```bash
npm install sharp
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// lib/images/index.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import sharp from 'sharp'
import { makeThumbnail, watermarkPreview } from '@/lib/images'

let original: Buffer

beforeAll(async () => {
  // imagen sólida 2000x1500 generada en memoria
  original = await sharp({
    create: { width: 2000, height: 1500, channels: 3, background: '#3366aa' },
  }).jpeg().toBuffer()
})

describe('makeThumbnail', () => {
  it('reduce el lado mayor a <= 600px manteniendo aspect ratio', async () => {
    const out = await makeThumbnail(original)
    const meta = await sharp(out).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(600)
    expect(meta.width! / meta.height!).toBeCloseTo(2000 / 1500, 1)
  })
})

describe('watermarkPreview', () => {
  it('devuelve una imagen válida del mismo aspect ratio', async () => {
    const out = await watermarkPreview(original, { text: 'Spoteado' })
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width! / meta.height!).toBeCloseTo(2000 / 1500, 1)
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test lib/images/index.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 4: Implementar `lib/images/index.ts`**

```ts
// lib/images/index.ts
import sharp from 'sharp'

const PREVIEW_MAX = 1400
const THUMB_MAX = 600

export async function makeThumbnail(original: Buffer): Promise<Buffer> {
  return sharp(original)
    .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer()
}

export type WatermarkOptions = {
  text?: string            // fallback si el fotógrafo no tiene logo
  logo?: Buffer            // logo del fotógrafo (PNG con alpha)
  position?: 'bottom-right' | 'bottom-left' | 'center'
  opacity?: number         // 0..1
}

export async function watermarkPreview(
  original: Buffer,
  opts: WatermarkOptions = {}
): Promise<Buffer> {
  const base = sharp(original).resize(PREVIEW_MAX, PREVIEW_MAX, {
    fit: 'inside',
    withoutEnlargement: true,
  })
  const meta = await base.clone().metadata()
  const w = meta.width ?? PREVIEW_MAX
  const h = meta.height ?? PREVIEW_MAX

  const gravity =
    opts.position === 'center' ? 'center'
    : opts.position === 'bottom-left' ? 'southwest'
    : 'southeast'

  let overlay: Buffer
  if (opts.logo) {
    const logoW = Math.round(w * 0.25)
    overlay = await sharp(opts.logo)
      .resize(logoW)
      .ensureAlpha(opts.opacity ?? 0.6)
      .png()
      .toBuffer()
  } else {
    const text = opts.text ?? 'Spoteado'
    const fontSize = Math.round(w * 0.04)
    const svg = `<svg width="${w}" height="${h}">
      <text x="${w - 20}" y="${h - 20}" text-anchor="end"
        font-family="sans-serif" font-size="${fontSize}"
        fill="white" fill-opacity="${opts.opacity ?? 0.6}">${text}</text></svg>`
    overlay = Buffer.from(svg)
  }

  return base
    .composite([{ input: overlay, gravity }])
    .jpeg({ quality: 82 })
    .toBuffer()
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test lib/images/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commitear**

```bash
git add lib/images package.json package-lock.json
git commit -m "feat: procesamiento de imágenes (thumbnail + watermark) con sharp"
```

---

## Task 4: Embeddings CLIP (`lib/embeddings`)

**Files:**
- Create: `lib/embeddings/index.ts`
- Create: `lib/embeddings/fake.ts`
- Modify: `.env.example` (+ `JINA_API_KEY`)
- Modify: `lib/env.ts` (+ `JINA_API_KEY`)

> El seam testeable es la interfaz `Embedder`; los tests de orquestación (Task 6) usan `FakeEmbedder`. La impl `JinaEmbedder` es wiring (verificada por integración).

- [ ] **Step 1: Definir interfaz + impl + dimensión**

```ts
// lib/embeddings/index.ts
import { env } from '@/lib/env'

export const EMBEDDING_DIM = 1024 // jina-clip-v2

export interface Embedder {
  embedImage(image: Buffer): Promise<number[]>
  embedText(text: string): Promise<number[]>
}

class JinaEmbedder implements Embedder {
  private async call(input: object[]): Promise<number[]> {
    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.JINA_API_KEY}`,
      },
      body: JSON.stringify({ model: 'jina-clip-v2', input }),
    })
    if (!res.ok) throw new Error(`Embedding API ${res.status}: ${await res.text()}`)
    const json = (await res.json()) as { data: { embedding: number[] }[] }
    return json.data[0].embedding
  }
  embedImage(image: Buffer) {
    return this.call([{ image: image.toString('base64') }])
  }
  embedText(text: string) {
    return this.call([{ text }])
  }
}

let singleton: Embedder | null = null
export function getEmbedder(): Embedder {
  if (!singleton) singleton = new JinaEmbedder()
  return singleton
}
```

- [ ] **Step 2: Fake para tests**

```ts
// lib/embeddings/fake.ts
import { type Embedder, EMBEDDING_DIM } from './index'

export class FakeEmbedder implements Embedder {
  calls: { kind: 'image' | 'text'; value: unknown }[] = []
  async embedImage(image: Buffer) {
    this.calls.push({ kind: 'image', value: image.length })
    return new Array(EMBEDDING_DIM).fill(0.1)
  }
  async embedText(text: string) {
    this.calls.push({ kind: 'text', value: text })
    return new Array(EMBEDDING_DIM).fill(0.2)
  }
}
```

- [ ] **Step 3: Agregar `JINA_API_KEY` al env**

En `lib/env.ts`, agregar al schema: `JINA_API_KEY: z.string().min(1),`. En `.env.example`: `JINA_API_KEY=your-jina-key`. Actualizar `lib/env.test.ts` para incluir `JINA_API_KEY: 'jina'` en el objeto `valid`.

- [ ] **Step 4: Verificar tests existentes siguen pasando + typecheck**

Run: `npm test lib/env.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commitear**

```bash
git add lib/embeddings lib/env.ts lib/env.test.ts .env.example
git commit -m "feat: interfaz de embeddings CLIP + impl Jina + fake"
```

---

## Task 5: Vectores Qdrant (`lib/vectors`) — TDD del payload

**Files:**
- Create: `lib/vectors/index.ts`
- Create: `lib/vectors/payload.test.ts`
- Modify: `lib/env.ts` + `.env.example` (+ `QDRANT_URL`, `QDRANT_API_KEY`)

- [ ] **Step 1: Instalar el cliente Qdrant**

```bash
npm install @qdrant/js-client-rest
```

- [ ] **Step 2: Escribir el test del builder de payload (que falla)**

```ts
// lib/vectors/payload.test.ts
import { describe, it, expect } from 'vitest'
import { buildPayload } from '@/lib/vectors'

describe('buildPayload', () => {
  it('mapea la foto a payload con captured_at en epoch segundos', () => {
    const payload = buildPayload({
      id: 'p1',
      photographer_id: 'u1',
      beach_slug: 'mar-del-plata',
      captured_at: '2026-05-24T09:00:00Z',
      time_block: 'morning',
      tags: ['rojo', 'backside'],
      status: 'ready',
      session_id: 's1',
    })
    expect(payload.beach_slug).toBe('mar-del-plata')
    expect(payload.captured_at).toBe(Math.floor(Date.parse('2026-05-24T09:00:00Z') / 1000))
    expect(payload.tags).toEqual(['rojo', 'backside'])
  })
})
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npm test lib/vectors/payload.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar `lib/vectors/index.ts`**

```ts
// lib/vectors/index.ts
import { QdrantClient } from '@qdrant/js-client-rest'
import { env } from '@/lib/env'
import { EMBEDDING_DIM } from '@/lib/embeddings'

export const PHOTOS_COLLECTION = 'photos'

export type PhotoVectorInput = {
  id: string
  photographer_id: string
  beach_slug: string
  captured_at: string // ISO
  time_block: string | null
  tags: string[]
  status: string
  session_id: string | null
}

export type PhotoPayload = Omit<PhotoVectorInput, 'captured_at'> & { captured_at: number }

export function buildPayload(input: PhotoVectorInput): PhotoPayload {
  return { ...input, captured_at: Math.floor(Date.parse(input.captured_at) / 1000) }
}

let client: QdrantClient | null = null
function qdrant() {
  if (!client) client = new QdrantClient({ url: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY })
  return client
}

export async function ensureCollection() {
  const exists = await qdrant().collectionExists(PHOTOS_COLLECTION)
  if (!exists.exists) {
    await qdrant().createCollection(PHOTOS_COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: 'Cosine' },
    })
  }
}

export async function upsertPhoto(vector: number[], input: PhotoVectorInput) {
  await qdrant().upsert(PHOTOS_COLLECTION, {
    points: [{ id: input.id, vector, payload: buildPayload(input) }],
  })
}

export async function deletePhoto(id: string) {
  await qdrant().delete(PHOTOS_COLLECTION, { points: [id] })
}

export type SearchFilter = {
  beach_slug?: string
  time_block?: string
  tags?: string[]
  capturedFrom?: number // epoch s
  capturedTo?: number
}

export async function searchPhotos(vector: number[], filter: SearchFilter, limit = 60) {
  const must: object[] = [{ key: 'status', match: { value: 'ready' } }]
  if (filter.beach_slug) must.push({ key: 'beach_slug', match: { value: filter.beach_slug } })
  if (filter.time_block) must.push({ key: 'time_block', match: { value: filter.time_block } })
  if (filter.tags?.length) must.push({ key: 'tags', match: { any: filter.tags } })
  if (filter.capturedFrom || filter.capturedTo) {
    must.push({ key: 'captured_at', range: { gte: filter.capturedFrom, lte: filter.capturedTo } })
  }
  const res = await qdrant().search(PHOTOS_COLLECTION, { vector, filter: { must }, limit })
  return res.map((r) => ({ id: String(r.id), score: r.score }))
}
```

- [ ] **Step 5: Agregar env de Qdrant**

`lib/env.ts`: `QDRANT_URL: z.string().url()`, `QDRANT_API_KEY: z.string().min(1)`. `.env.example`: `QDRANT_URL=` y `QDRANT_API_KEY=`. Agregar ambos al objeto `valid` de `lib/env.test.ts`.

- [ ] **Step 6: Correr tests + typecheck**

Run: `npm test lib/vectors/payload.test.ts lib/env.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Inicializar la colección + commit**

Crear un script `scripts/init-qdrant.ts` que llame a `ensureCollection()` y correrlo una vez (`npx tsx scripts/init-qdrant.ts`), o llamarlo lazy en el primer upsert. Verificar en el dashboard de Qdrant que existe la colección `photos` con tamaño 1024.

```bash
git add lib/vectors lib/env.ts lib/env.test.ts .env.example package.json package-lock.json
git commit -m "feat: cliente Qdrant + payload + upsert/delete/search"
```

---

## Task 6: Orquestación `processPhoto` — TDD con fakes

**Files:**
- Create: `lib/photos/types.ts`
- Create: `lib/photos/process.ts`
- Create: `lib/photos/process.test.ts`

- [ ] **Step 1: Tipos compartidos**

```ts
// lib/photos/types.ts
export type ProcessDeps = {
  downloadOriginal: (path: string) => Promise<Buffer>
  uploadPublic: (path: string, data: Buffer) => Promise<void>
  embedImage: (image: Buffer) => Promise<number[]>
  indexVector: (vector: number[]) => Promise<void>
  makePreview: (original: Buffer) => Promise<Buffer>
  makeThumb: (original: Buffer) => Promise<Buffer>
  updatePhoto: (patch: Record<string, unknown>) => Promise<void>
}
export type PhotoRow = { id: string; original_path: string }
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// lib/photos/process.test.ts
import { describe, it, expect, vi } from 'vitest'
import { processPhoto } from '@/lib/photos/process'
import type { ProcessDeps, PhotoRow } from '@/lib/photos/types'

function makeDeps(over: Partial<ProcessDeps> = {}): ProcessDeps {
  return {
    downloadOriginal: vi.fn(async () => Buffer.from('orig')),
    uploadPublic: vi.fn(async () => {}),
    embedImage: vi.fn(async () => [0.1, 0.2]),
    indexVector: vi.fn(async () => {}),
    makePreview: vi.fn(async () => Buffer.from('prev')),
    makeThumb: vi.fn(async () => Buffer.from('thumb')),
    updatePhoto: vi.fn(async () => {}),
    ...over,
  }
}
const photo: PhotoRow = { id: 'p1', original_path: 'u1/p1.jpg' }

describe('processPhoto', () => {
  it('procesa, indexa y marca ready', async () => {
    const deps = makeDeps()
    await processPhoto(deps, photo)
    expect(deps.makePreview).toHaveBeenCalled()
    expect(deps.indexVector).toHaveBeenCalledWith([0.1, 0.2])
    const lastPatch = (deps.updatePhoto as any).mock.calls.at(-1)[0]
    expect(lastPatch).toMatchObject({ status: 'ready', embedding_status: 'done' })
  })

  it('si falla el embedding, queda ready pero embedding_status=failed', async () => {
    const deps = makeDeps({ embedImage: vi.fn(async () => { throw new Error('down') }) })
    await processPhoto(deps, photo)
    const patches = (deps.updatePhoto as any).mock.calls.map((c: any[]) => c[0])
    const merged = Object.assign({}, ...patches)
    expect(merged.status).toBe('ready')
    expect(merged.embedding_status).toBe('failed')
    expect(deps.indexVector).not.toHaveBeenCalled()
  })

  it('si falla el procesamiento de imagen, marca failed', async () => {
    const deps = makeDeps({ makePreview: vi.fn(async () => { throw new Error('corrupt') }) })
    await expect(processPhoto(deps, photo)).resolves.toBeUndefined()
    const patches = (deps.updatePhoto as any).mock.calls.map((c: any[]) => c[0])
    expect(patches.at(-1)).toMatchObject({ status: 'failed' })
  })
})
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npm test lib/photos/process.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar `lib/photos/process.ts`**

```ts
// lib/photos/process.ts
import type { ProcessDeps, PhotoRow } from './types'

/**
 * Pipeline idempotente por foto. La imagen es obligatoria (si falla → failed).
 * El embedding es best-effort: si falla, la foto queda 'ready' (buscable por
 * filtros) con embedding_status='failed' para reintento posterior.
 */
export async function processPhoto(deps: ProcessDeps, photo: PhotoRow): Promise<void> {
  let original: Buffer
  let preview: Buffer
  let thumb: Buffer
  try {
    original = await deps.downloadOriginal(photo.original_path)
    preview = await deps.makePreview(original)
    thumb = await deps.makeThumb(original)
    await deps.uploadPublic(`${photo.id}/preview.jpg`, preview)
    await deps.uploadPublic(`${photo.id}/thumb.jpg`, thumb)
    await deps.updatePhoto({
      preview_path: `${photo.id}/preview.jpg`,
      thumb_path: `${photo.id}/thumb.jpg`,
      status: 'ready',
    })
  } catch {
    await deps.updatePhoto({ status: 'failed' })
    return
  }

  // Embedding best-effort.
  try {
    const vector = await deps.embedImage(original)
    await deps.indexVector(vector)
    await deps.updatePhoto({ embedding_status: 'done' })
  } catch {
    await deps.updatePhoto({ embedding_status: 'failed' })
  }
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npm test lib/photos/process.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commitear**

```bash
git add lib/photos
git commit -m "feat: orquestación processPhoto (pipeline idempotente, embedding best-effort)"
```

---

## Task 7: Route handler de procesamiento + signed upload URLs

**Files:**
- Create: `app/api/photos/[id]/process/route.ts`
- Create: `app/(dashboard)/_actions/upload.ts`

- [ ] **Step 1: Server action: crear signed upload URL + fila de foto**

```ts
// app/(dashboard)/_actions/upload.ts
'use server'

import { requireRole } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'

export async function createUploadTarget(input: {
  fileName: string
  beachId: string
  sessionId: string | null
  capturedAt: string
}) {
  const user = await requireRole('photographer')
  const supabase = await createClient()

  const path = `${user}/${crypto.randomUUID()}-${input.fileName}`
  const { data: signed, error: sErr } = await supabase.storage
    .from('originals')
    .createSignedUploadUrl(path)
  if (sErr || !signed) throw new Error('No se pudo crear la URL de subida')

  const { data: photo, error: pErr } = await supabase
    .from('photos')
    .insert({
      photographer_id: user,
      beach_id: input.beachId,
      session_id: input.sessionId,
      captured_at: input.capturedAt,
      original_path: path,
      status: 'processing',
    })
    .select('id')
    .single()
  if (pErr || !photo) throw new Error('No se pudo crear la foto')

  return { photoId: photo.id, token: signed.token, path }
}
```

> Nota: `requireRole` devuelve el rol; para el uid usar `requireUser()` y su `.id`. Ajustar: `const u = await requireUser(); await requireRole('photographer')` y usar `u.id`. (Mantener el contrato de Fase 0.)

- [ ] **Step 2: Route handler que dispara processPhoto**

```ts
// app/api/photos/[id]/process/route.ts
import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmbedder } from '@/lib/embeddings'
import { makeThumbnail, watermarkPreview } from '@/lib/images'
import { upsertPhoto } from '@/lib/vectors'
import { processPhoto } from '@/lib/photos/process'

export async function POST(_req: NextRequest, ctx: RouteContext<'/api/photos/[id]/process'>) {
  const { id } = await ctx.params
  const admin = createAdminClient()

  const { data: photo } = await admin
    .from('photos')
    .select('id, original_path, photographer_id, beach_id, session_id, captured_at, time_block')
    .eq('id', id)
    .single()
  if (!photo) return Response.json({ error: 'not found' }, { status: 404 })

  const { data: prof } = await admin
    .from('profiles')
    .select('watermark_position, watermark_opacity')
    .eq('id', photo.photographer_id)
    .single()
  const { data: beach } = await admin.from('beaches').select('slug').eq('id', photo.beach_id).single()

  await processPhoto(
    {
      downloadOriginal: async (path) => {
        const { data } = await admin.storage.from('originals').download(path)
        return Buffer.from(await data!.arrayBuffer())
      },
      uploadPublic: async (path, buf) => {
        await admin.storage.from('public').upload(path, buf, { contentType: 'image/jpeg', upsert: true })
      },
      makePreview: (orig) => watermarkPreview(orig, {
        position: prof?.watermark_position ?? 'bottom-right',
        opacity: prof?.watermark_opacity ?? 0.6,
      }),
      makeThumb: (orig) => makeThumbnail(orig),
      embedImage: (img) => getEmbedder().embedImage(img),
      indexVector: (vector) => upsertPhoto(vector, {
        id: photo.id,
        photographer_id: photo.photographer_id,
        beach_slug: beach?.slug ?? '',
        captured_at: photo.captured_at,
        time_block: photo.time_block,
        tags: [],
        status: 'ready',
        session_id: photo.session_id,
      }),
      updatePhoto: async (patch) => { await admin.from('photos').update(patch).eq('id', id) },
    },
    { id: photo.id, original_path: photo.original_path }
  )

  return Response.json({ ok: true })
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores. (Si `RouteContext` no resuelve, correr `npx next dev` una vez para generar los tipos, o `npx next typegen`.)

- [ ] **Step 4: Commitear**

```bash
git add "app/api/photos" "app/(dashboard)/_actions/upload.ts"
git commit -m "feat: signed upload URLs + route handler processPhoto"
```

---

## Task 8: UI de carga (dashboard/subir)

**Files:**
- Create: `app/(dashboard)/_actions/catalog.ts`
- Create: `app/(dashboard)/dashboard/subir/page.tsx`
- Create: `app/(dashboard)/dashboard/subir/uploader.tsx`

- [ ] **Step 1: Server actions de catálogo (crear sesión)**

```ts
// app/(dashboard)/_actions/catalog.ts
'use server'

import { requireUser } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createSession(input: {
  beachId: string; sessionDate: string; timeBlock: string | null; title: string
}) {
  const user = await requireUser()
  const supabase = await createClient()
  const { data, error } = await supabase.from('sessions').insert({
    photographer_id: user.id,
    beach_id: input.beachId,
    session_date: input.sessionDate,
    time_block: input.timeBlock,
    title: input.title,
  }).select('id').single()
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/fotos')
  return data.id as string
}
```

- [ ] **Step 2: Página de carga (server: trae playas)**

```tsx
// app/(dashboard)/dashboard/subir/page.tsx
import { requireRole } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { Uploader } from './uploader'

export default async function SubirPage() {
  await requireRole('photographer')
  const supabase = await createClient()
  const { data: beaches } = await supabase.from('beaches').select('id, name').order('name')
  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="font-serif text-2xl">Subir fotos</h1>
      <Uploader beaches={beaches ?? []} />
    </main>
  )
}
```

- [ ] **Step 3: Uploader client (sesión + subida directa + estado por foto)**

```tsx
// app/(dashboard)/dashboard/subir/uploader.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createSession } from '@/app/(dashboard)/_actions/catalog'
import { createUploadTarget } from '@/app/(dashboard)/_actions/upload'

type Item = { name: string; status: 'subiendo' | 'procesando' | 'listo' | 'error' }

export function Uploader({ beaches }: { beaches: { id: string; name: string }[] }) {
  const [beachId, setBeachId] = useState(beaches[0]?.id ?? '')
  const [date, setDate] = useState('')
  const [items, setItems] = useState<Item[]>([])

  async function onFiles(files: FileList) {
    const sessionId = await createSession({
      beachId, sessionDate: date, timeBlock: null, title: '',
    })
    const supabase = createClient()
    for (const file of Array.from(files)) {
      setItems((p) => [...p, { name: file.name, status: 'subiendo' }])
      const setStatus = (s: Item['status']) =>
        setItems((p) => p.map((it) => (it.name === file.name ? { ...it, status: s } : it)))
      try {
        const { photoId, token, path } = await createUploadTarget({
          fileName: file.name, beachId, sessionId, capturedAt: new Date(date).toISOString(),
        })
        const { error } = await supabase.storage.from('originals').uploadToSignedUrl(path, token, file)
        if (error) throw error
        setStatus('procesando')
        await fetch(`/api/photos/${photoId}/process`, { method: 'POST' })
        setStatus('listo')
      } catch {
        setStatus('error')
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <select value={beachId} onChange={(e) => setBeachId(e.target.value)} className="border-b border-ink/15 bg-transparent py-2">
          {beaches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border-b border-ink/15 bg-transparent py-2" />
      </div>
      <input type="file" multiple accept="image/*" disabled={!beachId || !date}
        onChange={(e) => e.target.files && onFiles(e.target.files)} />
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex justify-between border-b border-ink/5 py-1">
            <span>{it.name}</span>
            <span className={it.status === 'error' ? 'text-heart' : 'text-ink/60'}>{it.status}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Verificar end-to-end**

Run: `npm run dev`. Como fotógrafo: ir a `/dashboard/subir`, elegir playa + fecha, subir 2-3 imágenes. Cada una debe pasar `subiendo → procesando → listo`. Verificar en Supabase: filas en `photos` con `status=ready`, objetos en bucket `public` (preview/thumb), y punto en Qdrant.

- [ ] **Step 5: Commitear**

```bash
git add "app/(dashboard)/dashboard/subir" "app/(dashboard)/_actions/catalog.ts"
git commit -m "feat: UI de carga con subida directa y estado por foto"
```

---

## Task 9: Gestión de fotos/sesiones (precios + tags)

**Files:**
- Create: `app/(dashboard)/dashboard/fotos/page.tsx`
- Modify: `app/(dashboard)/_actions/catalog.ts` (+ setPrice, setPackPrice, setTags)

- [ ] **Step 1: Agregar actions de precio/tags**

```ts
// añadir a app/(dashboard)/_actions/catalog.ts
export async function setPhotoPrice(photoId: string, price: number) {
  const user = await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.from('photos').update({ price })
    .eq('id', photoId).eq('photographer_id', user.id) // authz: solo lo propio
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/fotos')
}

export async function setPackPrice(sessionId: string, packPrice: number) {
  const user = await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.from('sessions').update({ pack_price: packPrice })
    .eq('id', sessionId).eq('photographer_id', user.id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/fotos')
}
```

- [ ] **Step 2: Página de gestión (lista sesiones + fotos con precio editable)**

```tsx
// app/(dashboard)/dashboard/fotos/page.tsx
import { requireRole } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { setPhotoPrice } from '@/app/(dashboard)/_actions/catalog'

export default async function FotosPage() {
  const user = await requireRole('photographer')
  const supabase = await createClient()
  const { data: photos } = await supabase
    .from('photos')
    .select('id, price, status, thumb_path, session_id')
    .order('created_at', { ascending: false })

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="font-serif text-2xl">Mis fotos</h1>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(photos ?? []).map((p) => (
          <li key={p.id} className="flex flex-col gap-2 border border-ink/10 p-2">
            <span className="text-xs text-ink/50">{p.status}</span>
            <form action={async (fd: FormData) => { 'use server'; await setPhotoPrice(p.id, Number(fd.get('price'))) }}>
              <input name="price" type="number" defaultValue={p.price ?? ''} placeholder="$ precio"
                className="w-full border-b border-ink/15 bg-transparent py-1 text-sm" />
            </form>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

- [ ] **Step 3: Verificar**

Run: `npm run dev`. En `/dashboard/fotos`: ver las fotos subidas, editar el precio de una, recargar y confirmar que persiste.

- [ ] **Step 4: Commitear**

```bash
git add "app/(dashboard)/dashboard/fotos" "app/(dashboard)/_actions/catalog.ts"
git commit -m "feat: gestión de fotos/sesiones con precios editables"
```

---

## Task 10: Verificación final de la fase

- [ ] **Step 1: Suite completa**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tests PASS, sin errores de tipo, build OK.

- [ ] **Step 2: Smoke manual del flujo completo**

Como fotógrafo: subir una sesión de varias fotos → todas `ready` → aparecen en `/dashboard/fotos` → setear precios. Confirmar puntos en Qdrant y objetos en el bucket público.

---

## Self-Review (completado al escribir el plan)

**1. Cobertura del spec (flujo 7.1 + secciones de catálogo/seguridad):**
- Schema beaches/sessions/photos/tags + RLS → Task 1. ✅
- Buckets originals(privado)/public + policies → Task 1. ✅
- Subida directa + signed URL → Task 7, 8. ✅
- Pipeline processPhoto (watermark/thumb + embedding best-effort + Qdrant) → Tasks 3, 4, 5, 6, 7. ✅
- Estado por-foto (processing→ready/failed) → Task 6, 8. ✅
- Embedding sobre el original (no el preview con watermark) → Task 6/7 (embedImage recibe `original`). ✅
- Watermark personalizado del fotógrafo → Task 7 (lee `watermark_position/opacity`; el logo `watermark_path` se conecta cuando se implemente la config del fotógrafo, sub-tarea de esta fase o Fase 3). ✅
- Dashboard del fotógrafo (subir + gestionar) → Tasks 8, 9. ✅

**2. Placeholders:** sin TBD; código y comandos concretos en cada step. (Nota explícita: el `requireRole`→uid se resuelve combinando `requireUser()`.) ✅

**3. Consistencia de tipos:** `Embedder`/`EMBEDDING_DIM` (Task 4) usados por `lib/vectors` (Task 5) y el route handler (Task 7). `ProcessDeps` (Task 6) implementado exactamente en el route handler (Task 7). `buildPayload`/`PhotoVectorInput` consistentes entre Task 5 y 7. ✅

**Nota:** los `tags` se mandan vacíos al indexar en este corte; el set de tags por foto (UI + re-upsert del payload) queda como mejora dentro de Fase 1 o al inicio de Fase 2, donde los tags entran al filtro de búsqueda.
</content>
</invoke>
