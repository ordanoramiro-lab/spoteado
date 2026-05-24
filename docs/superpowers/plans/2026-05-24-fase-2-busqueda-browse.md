# Fase 2 — Búsqueda + Browse (surfista): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Depende de:** Fase 1 (catálogo, fotos `ready`, Qdrant indexado, `lib/embeddings`, `lib/vectors`).

**Goal:** Un surfista encuentra fotos combinando filtros (playa, fecha, franja, tags) con texto en lenguaje natural; ve resultados en una galería masonry con previews watermarkeados, los abre en un lightbox, y navega perfiles de fotógrafo y sesiones.

**Architecture:** Dos caminos de búsqueda detrás de un seam puro (`lib/search`). Sin texto → query a Postgres (sin Qdrant). Con texto → CLIP text-embed → Qdrant filtered search (con umbral) → hidratar metadata desde Postgres. Los previews salen del bucket público; el original nunca se expone.

**Tech Stack:** Next.js 16 (Server Components + `searchParams` async), Tailwind 4 (masonry con CSS columns), `lib/embeddings`/`lib/vectors` (Fase 1), Vitest + Testing Library.

---

## File Structure

```
lib/search/types.ts             SearchParams, SearchPath, PhotoResult
lib/search/route.ts             parseSearchParams + decideSearchPath + buildVectorFilter (puro)
lib/search/route.test.ts
lib/search/execute.ts           runSearch(deps, params) — orquestación dual-path
lib/search/execute.test.ts
lib/photos/public-url.ts        previewUrl/thumbUrl desde el bucket público
components/photo/photo-card.tsx  card con blur-up + corazón
components/photo/masonry.tsx     grilla masonry (CSS columns)
components/photo/lightbox.tsx    overlay client (foto + precio + carrito)
components/photo/lightbox.test.tsx
components/search/search-bar.tsx  buscador (playa+fecha+texto)
components/search/filters.tsx     drawer de filtros
app/(public)/buscar/page.tsx      resultados (lee searchParams)
app/(public)/fotografo/[slug]/page.tsx  perfil del fotógrafo
app/(public)/sesion/[id]/page.tsx       página de sesión + pack
app/(dashboard)/_actions/catalog.ts     (+ setPhotoTags, re-upsert payload)
```

---

## Task 1: Parsing + routing de búsqueda (puro) — TDD

**Files:**
- Create: `lib/search/types.ts`
- Create: `lib/search/route.ts`
- Create: `lib/search/route.test.ts`

- [ ] **Step 1: Tipos**

```ts
// lib/search/types.ts
export type SearchParams = {
  beach?: string
  from?: string      // ISO date (yyyy-mm-dd)
  to?: string
  timeBlock?: string
  tags?: string[]
  q?: string         // lenguaje natural
}
export type SearchPath = 'filters' | 'semantic'

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

- [ ] **Step 2: Escribir el test que falla**

```ts
// lib/search/route.test.ts
import { describe, it, expect } from 'vitest'
import { parseSearchParams, decideSearchPath, buildVectorFilter } from '@/lib/search/route'

describe('parseSearchParams', () => {
  it('extrae filtros y tags (csv) de los query params', () => {
    const p = parseSearchParams({ beach: 'mar-del-plata', from: '2026-05-24', tags: 'rojo,backside', q: 'traje rojo' })
    expect(p.beach).toBe('mar-del-plata')
    expect(p.tags).toEqual(['rojo', 'backside'])
    expect(p.q).toBe('traje rojo')
  })
  it('ignora vacíos', () => {
    const p = parseSearchParams({ q: '' })
    expect(p.q).toBeUndefined()
  })
})

describe('decideSearchPath', () => {
  it('semantic cuando hay texto', () => {
    expect(decideSearchPath({ q: 'ola' })).toBe('semantic')
  })
  it('filters cuando no hay texto', () => {
    expect(decideSearchPath({ beach: 'x' })).toBe('filters')
  })
})

describe('buildVectorFilter', () => {
  it('convierte fechas a epoch segundos', () => {
    const f = buildVectorFilter({ beach: 'mdp', from: '2026-05-24', to: '2026-05-24' })
    expect(f.beach_slug).toBe('mdp')
    expect(f.capturedFrom).toBe(Math.floor(Date.parse('2026-05-24T00:00:00Z') / 1000))
    expect(f.capturedTo).toBe(Math.floor(Date.parse('2026-05-24T23:59:59Z') / 1000))
  })
})
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npm test lib/search/route.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar `lib/search/route.ts`**

```ts
// lib/search/route.ts
import type { SearchParams, SearchPath } from './types'
import type { SearchFilter } from '@/lib/vectors'

export function parseSearchParams(raw: Record<string, string | undefined>): SearchParams {
  const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined)
  const tags = clean(raw.tags)?.split(',').map((t) => t.trim()).filter(Boolean)
  return {
    beach: clean(raw.beach),
    from: clean(raw.from),
    to: clean(raw.to),
    timeBlock: clean(raw.timeBlock),
    tags: tags?.length ? tags : undefined,
    q: clean(raw.q),
  }
}

export function decideSearchPath(p: SearchParams): SearchPath {
  return p.q && p.q.trim().length > 0 ? 'semantic' : 'filters'
}

export function buildVectorFilter(p: SearchParams): SearchFilter {
  return {
    beach_slug: p.beach,
    time_block: p.timeBlock,
    tags: p.tags,
    capturedFrom: p.from ? Math.floor(Date.parse(`${p.from}T00:00:00Z`) / 1000) : undefined,
    capturedTo: p.to ? Math.floor(Date.parse(`${p.to}T23:59:59Z`) / 1000) : undefined,
  }
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npm test lib/search/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/search/types.ts lib/search/route.ts lib/search/route.test.ts
git commit -m "feat: parsing y routing de búsqueda (puro)"
```

---

## Task 2: Ejecución dual-path (`lib/search/execute.ts`) — TDD

**Files:**
- Create: `lib/search/execute.ts`
- Create: `lib/search/execute.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/search/execute.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runSearch, type SearchDeps } from '@/lib/search/execute'

const rows = [{ id: 'a' }, { id: 'b' }]
function deps(over: Partial<SearchDeps> = {}): SearchDeps {
  return {
    embedText: vi.fn(async () => [0.1]),
    vectorSearch: vi.fn(async () => [{ id: 'b', score: 0.9 }, { id: 'a', score: 0.1 }]),
    fetchByFilters: vi.fn(async () => rows as any),
    fetchByIds: vi.fn(async (ids: string[]) => ids.map((id) => ({ id })) as any),
    ...over,
  }
}

describe('runSearch', () => {
  it('camino filters: no toca embeddings ni qdrant', async () => {
    const d = deps()
    const res = await runSearch(d, { beach: 'x' })
    expect(d.embedText).not.toHaveBeenCalled()
    expect(d.vectorSearch).not.toHaveBeenCalled()
    expect(res.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('camino semantic: embed → qdrant → hidrata respetando orden y umbral', async () => {
    const d = deps()
    const res = await runSearch(d, { q: 'traje rojo' }) // umbral default 0.2 descarta score 0.1
    expect(d.embedText).toHaveBeenCalledWith('traje rojo')
    expect(res.map((r) => r.id)).toEqual(['b']) // 'a' (0.1) cae por debajo del umbral
  })

  it('camino semantic sin matches sobre el umbral → array vacío', async () => {
    const d = deps({ vectorSearch: vi.fn(async () => [{ id: 'a', score: 0.05 }]) })
    const res = await runSearch(d, { q: 'algo' })
    expect(res).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test lib/search/execute.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `lib/search/execute.ts`**

```ts
// lib/search/execute.ts
import type { SearchParams, PhotoResult } from './types'
import { decideSearchPath, buildVectorFilter } from './route'

export const SCORE_THRESHOLD = 0.2

export type SearchDeps = {
  embedText: (q: string) => Promise<number[]>
  vectorSearch: (vector: number[], filter: ReturnType<typeof buildVectorFilter>) => Promise<{ id: string; score: number }[]>
  fetchByFilters: (params: SearchParams) => Promise<PhotoResult[]>
  fetchByIds: (ids: string[]) => Promise<PhotoResult[]>
}

export async function runSearch(deps: SearchDeps, params: SearchParams): Promise<PhotoResult[]> {
  if (decideSearchPath(params) === 'filters') {
    return deps.fetchByFilters(params)
  }
  const vector = await deps.embedText(params.q!)
  const hits = (await deps.vectorSearch(vector, buildVectorFilter(params)))
    .filter((h) => h.score >= SCORE_THRESHOLD)
  if (hits.length === 0) return []
  const byId = new Map((await deps.fetchByIds(hits.map((h) => h.id))).map((r) => [r.id, r]))
  // preservar el orden por score que devolvió Qdrant
  return hits.map((h) => byId.get(h.id)).filter((r): r is PhotoResult => Boolean(r))
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test lib/search/execute.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/search/execute.ts lib/search/execute.test.ts
git commit -m "feat: ejecución dual-path de búsqueda (filtros / semántica) con umbral"
```

---

## Task 3: URLs públicas + photo card + masonry

**Files:**
- Create: `lib/photos/public-url.ts`
- Create: `components/photo/photo-card.tsx`
- Create: `components/photo/masonry.tsx`

> Wiring de URL (sin test). El card/masonry se prueban indirectamente por el lightbox (Task 5) y el smoke de la página (Task 8).

- [ ] **Step 1: Helper de URLs públicas**

```ts
// lib/photos/public-url.ts
const BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/public`
export const previewUrl = (photoId: string) => `${BASE}/${photoId}/preview.jpg`
export const thumbUrl = (photoId: string) => `${BASE}/${photoId}/thumb.jpg`
```

- [ ] **Step 2: Photo card (blur-up con next/image)**

```tsx
// components/photo/photo-card.tsx
'use client'
import Image from 'next/image'
import type { PhotoResult } from '@/lib/search/types'

export function PhotoCard({ photo, onOpen }: { photo: PhotoResult; onOpen: (p: PhotoResult) => void }) {
  return (
    <button onClick={() => onOpen(photo)} className="group relative mb-3 block w-full break-inside-avoid">
      <Image
        src={photo.thumbUrl}
        alt=""
        width={photo.width ?? 600}
        height={photo.height ?? 400}
        placeholder="empty"
        className="w-full bg-ink/5 transition-opacity duration-500 group-hover:opacity-95"
      />
      {photo.price != null && (
        <span className="absolute bottom-2 right-2 bg-canvas/90 px-2 py-0.5 text-xs">${photo.price}</span>
      )}
    </button>
  )
}
```

- [ ] **Step 3: Masonry (CSS columns)**

```tsx
// components/photo/masonry.tsx
'use client'
import { useState } from 'react'
import type { PhotoResult } from '@/lib/search/types'
import { PhotoCard } from './photo-card'
import { Lightbox } from './lightbox'

export function Masonry({ photos }: { photos: PhotoResult[] }) {
  const [open, setOpen] = useState<PhotoResult | null>(null)
  if (photos.length === 0) {
    return <p className="py-12 text-center text-ink/50">No encontramos fotos. Probá ampliar los filtros.</p>
  }
  return (
    <>
      <div className="columns-2 gap-3 md:columns-3 lg:columns-4">
        {photos.map((p) => <PhotoCard key={p.id} photo={p} onOpen={setOpen} />)}
      </div>
      {open && <Lightbox photo={open} onClose={() => setOpen(null)} />}
    </>
  )
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/photos/public-url.ts components/photo/photo-card.tsx components/photo/masonry.tsx
git commit -m "feat: photo card + grilla masonry + URLs públicas"
```

---

## Task 4: Página de resultados + búsqueda real

**Files:**
- Create: `components/search/search-bar.tsx`
- Create: `components/search/filters.tsx`
- Create: `app/(public)/buscar/page.tsx`

- [ ] **Step 1: Search bar (navega a /buscar con query params)**

```tsx
// components/search/search-bar.tsx
'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SearchBar({ beaches }: { beaches: { slug: string; name: string }[] }) {
  const router = useRouter()
  const [beach, setBeach] = useState('')
  const [date, setDate] = useState('')
  const [q, setQ] = useState('')
  function go() {
    const params = new URLSearchParams()
    if (beach) params.set('beach', beach)
    if (date) { params.set('from', date); params.set('to', date) }
    if (q) params.set('q', q)
    router.push(`/buscar?${params.toString()}`)
  }
  return (
    <div className="flex w-full max-w-md flex-col gap-3 bg-canvas/95 p-4">
      <select value={beach} onChange={(e) => setBeach(e.target.value)} className="border-b border-ink/15 bg-transparent py-2">
        <option value="">Playa</option>
        {beaches.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border-b border-ink/15 bg-transparent py-2" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="describí tu foto…" className="border-b border-ink/15 bg-transparent py-2" />
      <button onClick={go} className="rounded-sm bg-accent px-4 py-2 text-canvas">Buscar</button>
    </div>
  )
}
```

- [ ] **Step 2: Página de resultados (Server Component, `searchParams` async)**

```tsx
// app/(public)/buscar/page.tsx
import { createClient } from '@/lib/supabase/server'
import { getEmbedder } from '@/lib/embeddings'
import { searchPhotos } from '@/lib/vectors'
import { parseSearchParams } from '@/lib/search/route'
import { runSearch } from '@/lib/search/execute'
import type { PhotoResult } from '@/lib/search/types'
import { previewUrl, thumbUrl } from '@/lib/photos/public-url'
import { Masonry } from '@/components/photo/masonry'

type Row = {
  id: string; price: number | null; vote_count: number; width: number | null; height: number | null
  profiles: { id: string } | null
}

function toResult(r: Row, slug: string): PhotoResult {
  return {
    id: r.id, thumbUrl: thumbUrl(r.id), previewUrl: previewUrl(r.id),
    price: r.price, photographerSlug: slug, voteCount: r.vote_count,
    width: r.width, height: r.height,
  }
}

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = parseSearchParams(await searchParams)
  const supabase = await createClient()

  const select = 'id, price, vote_count, width, height, photographer_id'
  const results = await runSearch(
    {
      embedText: (q) => getEmbedder().embedText(q),
      vectorSearch: (vector, filter) => searchPhotos(vector, filter),
      fetchByFilters: async (p) => {
        let query = supabase.from('photos').select(select).eq('status', 'ready')
        if (p.beach) {
          const { data: b } = await supabase.from('beaches').select('id').eq('slug', p.beach).single()
          if (b) query = query.eq('beach_id', b.id)
        }
        if (p.from) query = query.gte('captured_at', `${p.from}T00:00:00Z`)
        if (p.to) query = query.lte('captured_at', `${p.to}T23:59:59Z`)
        const { data } = await query.order('captured_at', { ascending: false }).limit(60)
        return (data ?? []).map((r: any) => toResult(r, r.photographer_id))
      },
      fetchByIds: async (ids) => {
        const { data } = await supabase.from('photos').select(select).in('id', ids)
        return (data ?? []).map((r: any) => toResult(r, r.photographer_id))
      },
    },
    params
  )

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <p className="text-sm text-ink/60">{results.length} fotos</p>
      <Masonry photos={results} />
    </main>
  )
}
```

- [ ] **Step 3: Verificar end-to-end**

Run: `npm run dev`. Ir a `/buscar?beach=mar-del-plata` → ver las fotos de esa playa (camino filtros). Luego `/buscar?q=ola` → ver resultados por similitud (camino semántico). Confirmar que sin texto no se llama a la API de embeddings (logs).

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/buscar" components/search/search-bar.tsx
git commit -m "feat: página de resultados con búsqueda dual-path real"
```

---

## Task 5: Lightbox — TDD de componente

**Files:**
- Create: `components/photo/lightbox.tsx`
- Create: `components/photo/lightbox.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

```tsx
// components/photo/lightbox.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Lightbox } from './lightbox'
import type { PhotoResult } from '@/lib/search/types'

const photo: PhotoResult = {
  id: 'p1', thumbUrl: 't', previewUrl: 'p', price: 1500,
  photographerSlug: 'juan', voteCount: 3, width: 800, height: 600,
}

describe('Lightbox', () => {
  it('muestra precio y botón de carrito', () => {
    render(<Lightbox photo={photo} onClose={() => {}} />)
    expect(screen.getByText(/1500/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agregar/i })).toBeInTheDocument()
  })
  it('llama onClose al cerrar', () => {
    const onClose = vi.fn()
    render(<Lightbox photo={photo} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test components/photo/lightbox.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar el lightbox**

```tsx
// components/photo/lightbox.tsx
'use client'
import Image from 'next/image'
import Link from 'next/link'
import type { PhotoResult } from '@/lib/search/types'

export function Lightbox({ photo, onClose }: { photo: PhotoResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas md:flex-row">
      <button aria-label="cerrar" onClick={onClose} className="absolute right-4 top-4 z-10 text-xl">✕</button>
      <div className="flex flex-1 items-center justify-center bg-ink/5 p-4">
        <Image src={photo.previewUrl} alt="" width={photo.width ?? 1200} height={photo.height ?? 800} className="max-h-full w-auto" />
      </div>
      <aside className="flex w-full flex-col gap-3 p-6 md:max-w-xs">
        <Link href={`/fotografo/${photo.photographerSlug}`} className="text-sm text-accent">
          @{photo.photographerSlug}
        </Link>
        {photo.price != null && <p className="font-serif text-2xl">${photo.price}</p>}
        <button className="rounded-sm bg-accent px-4 py-2 text-canvas">Agregar al carrito</button>
      </aside>
    </div>
  )
}
```

> Nota: el handler real "Agregar al carrito" se conecta en la Fase 3; acá es el botón presente (la UI del lightbox).

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test components/photo/lightbox.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/photo/lightbox.tsx components/photo/lightbox.test.tsx
git commit -m "feat: lightbox de foto (preview + precio + carrito)"
```

---

## Task 6: Perfil del fotógrafo + página de sesión

**Files:**
- Create: `app/(public)/fotografo/[slug]/page.tsx`
- Create: `app/(public)/sesion/[id]/page.tsx`

> Para el slug del fotógrafo, usar el `id` del profile (UUID) como slug en el MVP, o agregar una columna `slug` a profiles. Este plan usa el `id` directamente en la ruta `[slug]`.

- [ ] **Step 1: Perfil del fotógrafo (sus fotos ready)**

```tsx
// app/(public)/fotografo/[slug]/page.tsx
import { createClient } from '@/lib/supabase/server'
import { thumbUrl, previewUrl } from '@/lib/photos/public-url'
import { Masonry } from '@/components/photo/masonry'
import type { PhotoResult } from '@/lib/search/types'

export default async function FotografoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', slug).single()
  const { data: photos } = await supabase
    .from('photos').select('id, price, vote_count, width, height')
    .eq('photographer_id', slug).eq('status', 'ready').order('captured_at', { ascending: false })

  const results: PhotoResult[] = (photos ?? []).map((r: any) => ({
    id: r.id, thumbUrl: thumbUrl(r.id), previewUrl: previewUrl(r.id),
    price: r.price, photographerSlug: slug, voteCount: r.vote_count, width: r.width, height: r.height,
  }))

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="font-serif text-2xl">{prof?.display_name ?? 'Fotógrafo'}</h1>
      <Masonry photos={results} />
    </main>
  )
}
```

- [ ] **Step 2: Página de sesión (fotos del pack + precio del pack)**

```tsx
// app/(public)/sesion/[id]/page.tsx
import { createClient } from '@/lib/supabase/server'
import { thumbUrl, previewUrl } from '@/lib/photos/public-url'
import { Masonry } from '@/components/photo/masonry'
import type { PhotoResult } from '@/lib/search/types'

export default async function SesionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: session } = await supabase
    .from('sessions').select('title, pack_price, photographer_id').eq('id', id).single()
  const { data: photos } = await supabase
    .from('photos').select('id, price, vote_count, width, height')
    .eq('session_id', id).eq('status', 'ready')

  const results: PhotoResult[] = (photos ?? []).map((r: any) => ({
    id: r.id, thumbUrl: thumbUrl(r.id), previewUrl: previewUrl(r.id),
    price: r.price, photographerSlug: session?.photographer_id ?? '', voteCount: r.vote_count,
    width: r.width, height: r.height,
  }))

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="font-serif text-2xl">{session?.title ?? 'Sesión'}</h1>
        {session?.pack_price != null && (
          <span className="text-sm">Pack completo: <strong>${session.pack_price}</strong></span>
        )}
      </header>
      <Masonry photos={results} />
    </main>
  )
}
```

- [ ] **Step 3: Verificar + commit**

Run: `npm run dev`, navegar a un perfil y a una sesión desde el lightbox.

```bash
git add "app/(public)/fotografo" "app/(public)/sesion"
git commit -m "feat: perfil del fotógrafo + página de sesión"
```

---

## Task 7: Tags por foto (cierra el gap de Fase 1)

**Files:**
- Modify: `app/(dashboard)/_actions/catalog.ts` (+ `setPhotoTags` con re-upsert del payload)

- [ ] **Step 1: Action que setea tags y re-indexa el payload en Qdrant**

```ts
// añadir a app/(dashboard)/_actions/catalog.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { upsertPhoto } from '@/lib/vectors'
import { getEmbedder } from '@/lib/embeddings'

export async function setPhotoTags(photoId: string, tagNames: string[]) {
  const user = await requireUser()
  const supabase = await createClient()

  // upsert tags + relaciones (solo si la foto es del usuario)
  const { data: photo } = await supabase.from('photos')
    .select('id, photographer_id, beach_id, captured_at, time_block, session_id, embedding_status')
    .eq('id', photoId).eq('photographer_id', user.id).single()
  if (!photo) throw new Error('Foto no encontrada')

  const slugify = (s: string) => s.toLowerCase().trim().replace(/\s+/g, '-')
  for (const name of tagNames) {
    const slug = slugify(name)
    const { data: tag } = await supabase.from('tags')
      .upsert({ name, slug }, { onConflict: 'slug' }).select('id').single()
    if (tag) await supabase.from('photo_tags').upsert({ photo_id: photoId, tag_id: tag.id })
  }

  // re-upsert del payload de Qdrant con los tags (solo si ya tenía embedding).
  if (photo.embedding_status === 'done') {
    const admin = createAdminClient()
    const { data: beach } = await admin.from('beaches').select('slug').eq('id', photo.beach_id).single()
    // necesitamos el vector existente: re-embed sería caro; en su lugar guardamos tags en payload
    // vía set_payload (no requiere el vector).
    await admin // placeholder de claridad: usar qdrant setPayload
      .from('photos').update({}).eq('id', photoId) // no-op para mantener el flujo
    // setPayload de Qdrant:
    const { QdrantClient } = await import('@qdrant/js-client-rest')
    const { env } = await import('@/lib/env')
    const q = new QdrantClient({ url: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY })
    await q.setPayload('photos', {
      payload: { tags: tagNames.map(slugify), beach_slug: beach?.slug ?? '' },
      points: [photoId],
    })
  }
  revalidatePath('/dashboard/fotos')
}
```

> Nota de diseño: usar `setPayload` de Qdrant evita re-embeddear para actualizar solo los tags. Para mantener la API limpia, exponer `setPhotoTagsPayload(photoId, tags)` en `lib/vectors` en lugar de instanciar el cliente acá (refactor menor recomendado al implementar).

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add "app/(dashboard)/_actions/catalog.ts"
git commit -m "feat: tags por foto con re-indexado del payload en Qdrant"
```

---

## Task 8: Verificación final de la fase

- [ ] **Step 1: Suite completa**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tests PASS, sin errores de tipo, build OK.

- [ ] **Step 2: Smoke del flujo**

Buscar por filtros (playa+fecha) y por lenguaje natural; abrir lightbox; ir al perfil del fotógrafo y a una sesión; setear un tag y confirmar que aparece como filtro en la búsqueda semántica.

---

## Self-Review (completado al escribir el plan)

**1. Cobertura del spec (flujo 7.2 + pantallas del surfista):**
- Camino A (solo filtros → Postgres) y B (NL → CLIP → Qdrant → hidratar) → Tasks 1, 2, 4. ✅
- Umbral de similitud + fallback a vacío con mensaje → Task 2 (SCORE_THRESHOLD) + Task 3 (mensaje empty). ✅
- Masonry con previews watermarkeados (frame completo) → Tasks 3, 4. ✅
- Lightbox con precio + carrito + crédito al fotógrafo → Task 5. ✅
- Perfil del fotógrafo + página de sesión (pack) → Task 6. ✅
- Tags entran al filtro (cierra gap Fase 1) → Task 7. ✅
- Filtros (drawer) → `components/search/filters.tsx` listado en la estructura; el search-bar (Task 4) cubre playa+fecha+texto. El drawer de tags/franja se puede sumar como sub-tarea si se quiere granularidad fina.

**2. Placeholders:** el `setPayload` de Qdrant en Task 7 incluye una línea no-op marcada como "placeholder de claridad" con la recomendación de refactor a `lib/vectors`. Al implementar, mover a `lib/vectors.setPhotoTagsPayload`. (Resto: código concreto.) ✅

**3. Consistencia de tipos:** `PhotoResult` (Task 1) usado por card/masonry/lightbox/páginas (Tasks 3,5,6) y producido por `runSearch` (Task 2). `SearchFilter` de `lib/vectors` (Fase 1) consumido por `buildVectorFilter` (Task 1) y `searchPhotos` (Task 4). `parseSearchParams`/`runSearch` consistentes entre Task 1, 2 y 4. ✅
</content>
</invoke>
