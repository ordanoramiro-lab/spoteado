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
