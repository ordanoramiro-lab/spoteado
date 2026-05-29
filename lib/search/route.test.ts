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
