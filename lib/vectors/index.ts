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
    if (v !== undefined) payload[cat] = v
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
  // Quitar claves undefined: si viajaran a Qdrant como null romperían el invariante is_empty.
  const clean = Object.fromEntries(
    Object.entries(facets).filter(([, v]) => v !== undefined)
  )
  await qdrant().setPayload(PHOTOS_COLLECTION, { payload: clean, points: [photoId] })
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
