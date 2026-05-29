import { isValidFacet, type FacetCategory } from '@/lib/facets'
import type { PhotoFacets } from '@/lib/vectors'

export type FacetPrediction = { category: string; value: string; confidence: number }

export interface Classifier {
  classify(image: Buffer): Promise<FacetPrediction[]>
}

export const CONFIDENCE_THRESHOLD = 0.7

// Blindaje: solo se asigna una faceta válida cuya confianza supere el umbral.
// Ante empate de categoría, gana la mayor confianza. El resto queda null (no aparece).
export function applyThreshold(preds: FacetPrediction[], threshold = CONFIDENCE_THRESHOLD): PhotoFacets {
  const best: Record<string, FacetPrediction> = {}
  for (const p of preds) {
    if (p.confidence < threshold) continue
    if (!isValidFacet(p.category, p.value)) continue
    const cur = best[p.category]
    if (!cur || p.confidence > cur.confidence) best[p.category] = p
  }
  const out: PhotoFacets = {}
  for (const [cat, p] of Object.entries(best)) out[cat as FacetCategory] = p.value
  return out
}
