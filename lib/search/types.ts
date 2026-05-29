import type { FacetCategory } from '@/lib/facets'

export type ParsedFilters = {
  beach_slug?: string
  timeBlock?: string[]
  from?: string // ISO yyyy-mm-dd
  to?: string
  facets?: Partial<Record<FacetCategory, string[]>>
}

export type QueryUnderstanding = {
  filters: ParsedFilters
  visualQuery: string // texto para CLIP (color, vestimenta, apariencia)
}

export type UnderstandContext = {
  beaches: { slug: string; name: string }[]
  today: string // ISO yyyy-mm-dd
}

export interface QueryUnderstander {
  understand(raw: string, ctx: UnderstandContext): Promise<QueryUnderstanding>
}

export type PhotoResult = {
  id: string
  thumbUrl: string
  previewUrl: string
  price: number | null
  photographerSlug: string
  voteCount: number
  width: number | null
  height: number | null
}
