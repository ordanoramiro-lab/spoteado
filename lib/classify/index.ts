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
import sharp from 'sharp'
import { env } from '@/lib/env'
import { computeCrop, isUsableBox, type Box } from './crop'

// Prompt estático: describe el vocabulario permitido por categoría.
const VOCAB_DESC = FACET_CATEGORIES
  .map((c) => `- ${c}: ${FACET_VOCAB[c].join(', ')}`)
  .join('\n')

const SYSTEM = `Sos un clasificador experto de fotos de surf. Observá con MUCHA atención al surfista \
(puede ser chico o estar lejos) y asigná facetas usando EXCLUSIVAMENTE estos valores:
${VOCAB_DESC}

Definiciones (NO confundir):
- board_type: longboard (tabla larga >8'); tabla-corta (shortboard de performance); fish (corta y ancha, cola de golondrina); evolutiva (intermedia/funboard); gun (larga y angosta, olas grandes); espuma (softboard de escuela); sup (con remo); bodyboard (tabla CORTA de espuma, el rider va ACOSTADO de panza o de rodillas, NO parado); bodysurf (SIN tabla, solo el cuerpo).
- patas_de_rana: aletas en los pies. Típicas de bodyboard y bodysurf. Si ves al rider acostado/de panza, casi seguro lleva patas → 'si'. Si el surfista va claramente PARADO sobre una tabla rígida y no se ven aletas → 'no' (respondé con confianza, es fácil).
- maneuver: remando (acostado, remando, sin olla); drop (recién despegando, BAJANDO la cara de la ola al inicio); bottom-turn (giro en la base); cutback (giro de regreso hacia la espuma); floater (deslizando por ARRIBA de la espuma); aereo (en el AIRE, despegado del agua); re-entry (pegándole al labio arriba); tubo (ENVUELTO dentro del hueco de la ola, hay una cortina de agua tapándolo); caida (wipeout, perdió el control); caminando (longboard, caminando hacia la punta). IMPORTANTE: drop (bajando al inicio) NO es tubo (estar dentro del hueco cerrado).
- stance: SOLO si se distingue claramente qué pie va adelante. goofy = pie DERECHO adelante; regular = pie IZQUIERDO adelante. Si no se ve con claridad cuál pie va adelante, NO incluyas stance.
- sexo: hombre/mujer solo si es razonablemente claro.

Reglas: una sola faceta por categoría. Respondé las facetas que veas con razonable seguridad (no te quedes corto en las fáciles como sexo o patas_de_rana=no). \
Sé especialmente ESTRICTO con 'stance' y con 'board_type' cuando el surfista esté lejos o chico: ante la duda real, omitilos en vez de adivinar. \
Devolvé un array 'facets' con {category, value, confidence} (confidence 0..1, reflejando cuán seguro estás).`

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

const LOCATE_SYSTEM = `Ubicá al SURFISTA PRINCIPAL de la foto (la persona surfeando, junto con su tabla). \
Devolvé un bounding box que lo contenga (persona + tabla) en fracciones 0..1: \
x,y = esquina superior izquierda; w,h = ancho y alto. \
Si hay varios, elegí al más prominente/protagonista. Si NO hay nadie surfeando, found=false (y x,y,w,h en 0).`

const BBOX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean' },
    x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
  },
  required: ['found', 'x', 'y', 'w', 'h'],
}

const CLASSIFY_SIZE = 1536

export class OpenAIClassifier implements Classifier {
  private client = new OpenAI({ apiKey: env.OPENAI_API_KEY })

  // Paso 1: ubicar al surfista para poder recortar y "hacerle zoom". Devuelve null si no encuentra.
  private async locate(normalized: Buffer): Promise<Box | null> {
    try {
      const small = await sharp(normalized).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
      const res = await this.client.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0,
        messages: [
          { role: 'system', content: LOCATE_SYSTEM },
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}`, detail: 'high' } },
          ] },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'bbox', strict: true, schema: BBOX_SCHEMA as { [key: string]: unknown } } },
      })
      const c = res.choices[0]?.message?.content
      if (!c) return null
      const j = JSON.parse(c) as { found: boolean; x: number; y: number; w: number; h: number }
      if (!j.found) return null
      return { x: j.x, y: j.y, w: j.w, h: j.h }
    } catch {
      return null // ante cualquier falla, se clasifica la imagen completa
    }
  }

  async classify(image: Buffer): Promise<FacetPrediction[]> {
    // Normalizar orientación a píxeles (aplica EXIF) para que el recorte coincida con lo que ve el modelo.
    // OpenAI no acepta avif/heic/tiff: sharp lo deja en JPEG.
    const normalized = await sharp(image).rotate().toBuffer()
    const meta = await sharp(normalized).metadata()

    // Paso 1: ubicar al surfista y recortar en alta resolución (zoom al sujeto chico).
    const box = await this.locate(normalized)
    let toClassify: Buffer
    if (box && isUsableBox(box) && meta.width && meta.height) {
      const c = computeCrop(meta.width, meta.height, box, 0.5)
      toClassify = await sharp(normalized)
        .extract({ left: c.left, top: c.top, width: c.width, height: c.height })
        .resize(CLASSIFY_SIZE, CLASSIFY_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
    } else {
      toClassify = await sharp(normalized)
        .resize(CLASSIFY_SIZE, CLASSIFY_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
    }

    // Paso 2: clasificar el recorte (o la foto entera) con alta resolución.
    const res = await this.client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0, // clasificación determinística: misma foto → misma faceta
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${toClassify.toString('base64')}`, detail: 'high' } },
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
