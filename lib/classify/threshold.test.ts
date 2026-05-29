import { describe, it, expect } from 'vitest'
import { applyThreshold, type FacetPrediction } from '@/lib/classify'

const preds: FacetPrediction[] = [
  { category: 'board_type', value: 'longboard', confidence: 0.95 },
  { category: 'stance', value: 'goofy', confidence: 0.5 },   // bajo umbral
  { category: 'sexo', value: 'hombre', confidence: 0.8 },
  { category: 'board_type', value: 'inventado', confidence: 0.99 }, // fuera de vocabulario
]

describe('applyThreshold', () => {
  it('asigna solo facetas válidas y por encima del umbral', () => {
    expect(applyThreshold(preds, 0.7)).toEqual({ board_type: 'longboard', sexo: 'hombre' })
  })
  it('si todo está por debajo del umbral devuelve objeto vacío (todo null)', () => {
    expect(applyThreshold([{ category: 'stance', value: 'goofy', confidence: 0.3 }], 0.7)).toEqual({})
  })
  it('ante dos predicciones de la misma categoría, gana la de mayor confianza', () => {
    const out = applyThreshold([
      { category: 'maneuver', value: 'cutback', confidence: 0.75 },
      { category: 'maneuver', value: 'floater', confidence: 0.9 },
    ], 0.7)
    expect(out).toEqual({ maneuver: 'floater' })
  })
})
