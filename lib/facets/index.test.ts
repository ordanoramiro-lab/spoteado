import { describe, it, expect } from 'vitest'
import { FACET_CATEGORIES, FACET_VOCAB, isValidFacet, sanitizeFacets } from '@/lib/facets'

describe('FACET_VOCAB', () => {
  it('tiene las cinco categorías determinísticas', () => {
    expect(FACET_CATEGORIES.sort()).toEqual(
      ['board_type', 'maneuver', 'patas_de_rana', 'sexo', 'stance'].sort()
    )
  })
  it('incluye la jerga acordada', () => {
    expect(FACET_VOCAB.board_type).toContain('longboard')
    expect(FACET_VOCAB.board_type).toContain('gun')
    expect(FACET_VOCAB.board_type).toContain('bodysurf')
    expect(FACET_VOCAB.maneuver).toContain('floater')
    expect(FACET_VOCAB.maneuver).toContain('aereo')
    expect(FACET_VOCAB.stance).toEqual(['goofy', 'regular'])
  })
})

describe('isValidFacet', () => {
  it('acepta valores del vocabulario', () => {
    expect(isValidFacet('board_type', 'longboard')).toBe(true)
  })
  it('rechaza categoría o valor desconocido', () => {
    expect(isValidFacet('board_type', 'inventado')).toBe(false)
    expect(isValidFacet('color', 'azul')).toBe(false)
  })
})

describe('sanitizeFacets', () => {
  it('descarta facetas fuera del vocabulario', () => {
    const out = sanitizeFacets([
      { category: 'board_type', value: 'longboard' },
      { category: 'sexo', value: 'alien' },
      { category: 'stance', value: 'goofy' },
    ])
    expect(out).toEqual([
      { category: 'board_type', value: 'longboard' },
      { category: 'stance', value: 'goofy' },
    ])
  })
})
