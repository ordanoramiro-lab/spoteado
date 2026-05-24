import { describe, it, expect } from 'vitest'
import { parseEnv } from '@/lib/env'

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
}

describe('parseEnv', () => {
  it('devuelve el env tipado cuando está completo', () => {
    expect(parseEnv(valid).NEXT_PUBLIC_SUPABASE_URL).toBe('https://x.supabase.co')
  })

  it('tira si falta una variable requerida', () => {
    const { NEXT_PUBLIC_SUPABASE_ANON_KEY, ...incomplete } = valid
    expect(() => parseEnv(incomplete)).toThrow()
  })

  it('tira si la URL no es válida', () => {
    expect(() => parseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: 'no-es-url' })).toThrow()
  })
})
