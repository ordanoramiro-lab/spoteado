import { describe, it, expect } from 'vitest'
import { parseRole, assertRole, ROLES } from '@/lib/auth/roles'

describe('parseRole', () => {
  it('acepta roles válidos', () => {
    expect(parseRole('photographer')).toBe('photographer')
    expect(parseRole('surfer')).toBe('surfer')
  })
  it('devuelve null para inválidos', () => {
    expect(parseRole('admin')).toBeNull()
    expect(parseRole(undefined)).toBeNull()
  })
})

describe('assertRole', () => {
  it('es true cuando el rol coincide', () => {
    expect(assertRole('photographer', 'photographer')).toBe(true)
  })
  it('es false cuando no coincide', () => {
    expect(assertRole('surfer', 'photographer')).toBe(false)
  })
})

describe('ROLES', () => {
  it('contiene los dos roles', () => {
    expect(ROLES).toEqual(['photographer', 'surfer'])
  })
})
