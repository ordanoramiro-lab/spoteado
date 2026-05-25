import { describe, it, expect } from 'vitest'
import { buildPayload } from '@/lib/vectors'

describe('buildPayload', () => {
  it('mapea la foto a payload con captured_at en epoch segundos', () => {
    const payload = buildPayload({
      id: 'p1',
      photographer_id: 'u1',
      beach_slug: 'mar-del-plata',
      captured_at: '2026-05-24T09:00:00Z',
      time_block: 'morning',
      tags: ['rojo', 'backside'],
      status: 'ready',
      session_id: 's1',
    })
    expect(payload.beach_slug).toBe('mar-del-plata')
    expect(payload.captured_at).toBe(Math.floor(Date.parse('2026-05-24T09:00:00Z') / 1000))
    expect(payload.tags).toEqual(['rojo', 'backside'])
  })
})
