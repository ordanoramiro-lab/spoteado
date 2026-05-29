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
