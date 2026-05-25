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
  return hits.map((h) => byId.get(h.id)).filter((r): r is PhotoResult => Boolean(r))
}
