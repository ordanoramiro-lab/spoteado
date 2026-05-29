import OpenAI from 'openai'
import { env } from '@/lib/env'
import { FACET_VOCAB, FACET_CATEGORIES } from '@/lib/facets'
import type { QueryUnderstander, QueryUnderstanding, UnderstandContext } from './types'

const TIME_BLOCKS = ['dawn', 'morning', 'midday', 'afternoon', 'sunset']

const FACET_PROPS = Object.fromEntries(
  FACET_CATEGORIES.map((c) => [c, { type: 'array', items: { type: 'string', enum: FACET_VOCAB[c] } }])
)

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    beach_slug: { type: ['string', 'null'] },
    timeBlock: { type: 'array', items: { type: 'string', enum: TIME_BLOCKS } },
    from: { type: ['string', 'null'] },
    to: { type: ['string', 'null'] },
    facets: { type: 'object', additionalProperties: false, properties: FACET_PROPS, required: [] },
    visualQuery: { type: 'string' },
  },
  required: ['visualQuery'],
}

function systemPrompt(ctx: UnderstandContext): string {
  const beaches = ctx.beaches.map((b) => `${b.name} → ${b.slug}`).join('; ')
  return `Sos el motor de búsqueda de fotos de surf Spoteado. Hoy es ${ctx.today}. \
Convertí la frase del surfista en filtros estructurados + una query visual.\n\
- Playas conocidas (nombre → slug): ${beaches}. Mapeá menciones al slug; si no reconocés, dejá null.\n\
- Fechas relativas ("el finde pasado", "ayer") → rango from/to ISO usando hoy.\n\
- timeBlock: ${TIME_BLOCKS.join(', ')} (mañana=morning, mediodía=midday, tarde=afternoon, atardecer=sunset, amanecer=dawn).\n\
- facets: usá SOLO los valores enum permitidos.\n\
- visualQuery: traducí a inglés SOLO lo visual que no es filtro (color de tabla/traje, vestimenta como "shirtless", apariencia). Si no hay nada visual, "".`
}

export class OpenAIUnderstander implements QueryUnderstander {
  private client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
  async understand(raw: string, ctx: UnderstandContext): Promise<QueryUnderstanding> {
    const res = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt(ctx) },
        { role: 'user', content: raw },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'query', strict: true, schema: SCHEMA as { [key: string]: unknown } } },
    })
    const content = res.choices[0]?.message?.content
    if (!content) throw new Error('understander: respuesta vacía')
    const j = JSON.parse(content)
    const facets: QueryUnderstanding['filters']['facets'] = {}
    for (const c of FACET_CATEGORIES) if (j.facets?.[c]?.length) facets[c] = j.facets[c]
    return {
      filters: {
        beach_slug: j.beach_slug ?? undefined,
        timeBlock: j.timeBlock?.length ? j.timeBlock : undefined,
        from: j.from ?? undefined,
        to: j.to ?? undefined,
        facets: Object.keys(facets).length ? facets : undefined,
      },
      visualQuery: j.visualQuery ?? '',
    }
  }
}

let singleton: QueryUnderstander | null = null
export function getUnderstander(): QueryUnderstander {
  if (!singleton) singleton = new OpenAIUnderstander()
  return singleton
}
