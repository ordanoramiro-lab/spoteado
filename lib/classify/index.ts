import { isValidFacet, type FacetCategory, FACET_VOCAB, FACET_CATEGORIES } from '@/lib/facets'
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

import OpenAI from 'openai'
import { env } from '@/lib/env'

// Prompt estático: describe el vocabulario permitido por categoría.
const VOCAB_DESC = FACET_CATEGORIES
  .map((c) => `- ${c}: ${FACET_VOCAB[c].join(', ')}`)
  .join('\n')

const SYSTEM = `Sos un clasificador de fotos de surf. Mirá la imagen y, SOLO si estás seguro, \
asigná facetas usando EXCLUSIVAMENTE estos valores:\n${VOCAB_DESC}\n\
Reglas: una sola faceta por categoría; si dudás, NO la incluyas (confidence baja). \
'patas_de_rana' es si/no según se vean. 'stance' es goofy (pie derecho adelante) o regular (izquierdo). \
Devolvé un array 'facets' con {category, value, confidence} (confidence 0..1).`

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    facets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', enum: FACET_CATEGORIES },
          value: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['category', 'value', 'confidence'],
      },
    },
  },
  required: ['facets'],
}

export class OpenAIClassifier implements Classifier {
  private client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
  async classify(image: Buffer): Promise<FacetPrediction[]> {
    const res = await this.client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0, // clasificación determinística: misma foto → misma faceta
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } },
        ] },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'facets', strict: true, schema: RESPONSE_SCHEMA as { [key: string]: unknown } },
      },
    })
    const raw = res.choices[0]?.message?.content
    if (!raw) return []
    const parsed = JSON.parse(raw) as { facets: FacetPrediction[] }
    return parsed.facets ?? []
  }
}

let singleton: Classifier | null = null
export function getClassifier(): Classifier {
  if (!singleton) singleton = new OpenAIClassifier()
  return singleton
}
