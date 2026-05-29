// lib/vectors/payload.test.ts
import { describe, it, expect } from 'vitest'
import { buildPayload, buildSearchFilter, type PhotoVectorInput } from '@/lib/vectors'

const base: PhotoVectorInput = {
  id: 'p1',
  photographer_id: 'u1',
  beach_slug: 'la-mole',
  captured_at: '2026-05-24T12:00:00Z',
  time_block: 'afternoon',
  facets: { board_type: 'longboard', stance: 'goofy' },
  status: 'ready',
  session_id: null,
}

describe('buildPayload', () => {
  it('convierte captured_at a epoch y aplana facetas asignadas', () => {
    const p = buildPayload(base)
    expect(p.captured_at).toBe(Math.floor(Date.parse(base.captured_at) / 1000))
    expect(p.board_type).toBe('longboard')
    expect(p.stance).toBe('goofy')
  })
  it('omite facetas no asignadas (null) en vez de escribir el campo', () => {
    const p = buildPayload(base)
    expect('sexo' in p).toBe(false)
    expect('maneuver' in p).toBe(false)
    expect('patas_de_rana' in p).toBe(false)
  })
})

describe('buildSearchFilter', () => {
  it('siempre exige status ready', () => {
    const f = buildSearchFilter({})
    expect(f.must).toContainEqual({ key: 'status', match: { value: 'ready' } })
  })
  it('una faceta requerida hace match OR de valores y NO excluye fotos sin el campo', () => {
    const f = buildSearchFilter({ facets: { board_type: ['longboard', 'fish'] } })
    expect(f.must).toContainEqual({
      should: [
        { key: 'board_type', match: { any: ['longboard', 'fish'] } },
        { is_empty: { key: 'board_type' } },
      ],
    })
  })
  it('combina beach + rango de fechas en must', () => {
    const f = buildSearchFilter({ beach_slug: 'la-mole', capturedFrom: 100, capturedTo: 200 })
    expect(f.must).toContainEqual({ key: 'beach_slug', match: { value: 'la-mole' } })
    expect(f.must).toContainEqual({ key: 'captured_at', range: { gte: 100, lte: 200 } })
  })
})
