import { describe, it, expect } from 'vitest'
import { computeCrop, isUsableBox } from '@/lib/classify/crop'

describe('computeCrop', () => {
  it('expande con margen y convierte a píxeles', () => {
    // box chico y centrado en una imagen 1000x1000, margen 0.5
    const c = computeCrop(1000, 1000, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 0.5)
    // margen = 0.1 a cada lado → x0=0.3,y0=0.3,x1=0.7,y1=0.7
    expect(c).toEqual({ left: 300, top: 300, width: 400, height: 400 })
  })
  it('clampea a los bordes (no se sale de la imagen)', () => {
    const c = computeCrop(1000, 1000, { x: 0.0, y: 0.0, w: 0.2, h: 0.2 }, 0.5)
    expect(c.left).toBe(0)
    expect(c.top).toBe(0)
    expect(c.left + c.width).toBeLessThanOrEqual(1000)
    expect(c.top + c.height).toBeLessThanOrEqual(1000)
  })
  it('nunca devuelve ancho/alto cero', () => {
    const c = computeCrop(800, 600, { x: 0.5, y: 0.5, w: 0.001, h: 0.001 }, 0)
    expect(c.width).toBeGreaterThanOrEqual(1)
    expect(c.height).toBeGreaterThanOrEqual(1)
  })
})

describe('isUsableBox', () => {
  it('acepta un box razonable', () => {
    expect(isUsableBox({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 })).toBe(true)
  })
  it('rechaza box degenerado (muy chico)', () => {
    expect(isUsableBox({ x: 0.5, y: 0.5, w: 0.005, h: 0.005 })).toBe(false)
  })
  it('rechaza box que cubre casi toda la imagen (no aporta zoom)', () => {
    expect(isUsableBox({ x: 0.0, y: 0.0, w: 1, h: 1 })).toBe(false)
  })
})
