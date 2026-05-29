import { describe, it, expect } from 'vitest'
import { parseEnv } from '@/lib/env'

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  JINA_API_KEY: 'jina',
  QDRANT_URL: 'https://x.qdrant.io',
  QDRANT_API_KEY: 'qdrant',
  OPENAI_API_KEY: 'sk-test',
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

  it('requiere OPENAI_API_KEY', () => {
    expect(() => parseEnv({ ...valid, OPENAI_API_KEY: undefined })).toThrow()
    expect(parseEnv(valid).OPENAI_API_KEY).toBe('sk-test')
  })
})
