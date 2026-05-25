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

// Qdrant exige un índice de payload en cada campo usado para filtrar en la búsqueda.
const PAYLOAD_INDEXES: { field: string; schema: 'keyword' | 'integer' }[] = [
  { field: 'status', schema: 'keyword' },
  { field: 'beach_slug', schema: 'keyword' },
  { field: 'time_block', schema: 'keyword' },
  { field: 'tags', schema: 'keyword' },
  { field: 'session_id', schema: 'keyword' },
  { field: 'captured_at', schema: 'integer' },
]

export async function ensureCollection() {
  const exists = await qdrant().collectionExists(PHOTOS_COLLECTION)
  if (!exists.exists) {
    await qdrant().createCollection(PHOTOS_COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: 'Cosine' },
    })
  }
  // Índices de payload (idempotente: si ya existe, Qdrant lo ignora/recrea sin romper).
  for (const { field, schema } of PAYLOAD_INDEXES) {
    try {
      await qdrant().createPayloadIndex(PHOTOS_COLLECTION, {
        field_name: field,
        field_schema: schema,
      })
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

export async function deletePhoto(id: string) {
  await qdrant().delete(PHOTOS_COLLECTION, { points: [id] })
}

export type SearchFilter = {
  beach_slug?: string
  time_block?: string
  tags?: string[]
  capturedFrom?: number
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

export async function setPhotoTagsPayload(photoId: string, tags: string[]) {
  await qdrant().setPayload(PHOTOS_COLLECTION, { payload: { tags }, points: [photoId] })
}
