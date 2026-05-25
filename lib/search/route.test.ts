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
