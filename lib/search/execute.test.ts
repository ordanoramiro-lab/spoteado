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
