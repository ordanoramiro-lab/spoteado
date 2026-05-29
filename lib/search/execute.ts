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
