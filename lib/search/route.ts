// lib/search/route.ts
import type { ParsedFilters } from './types'
import type { SearchFilter } from '@/lib/vectors'

export function buildVectorFilter(f: ParsedFilters): SearchFilter {
  return {
    beach_slug: f.beach_slug,
    time_block: f.timeBlock,
    facets: f.facets,
    capturedFrom: f.from ? Math.floor(Date.parse(`${f.from}T00:00:00Z`) / 1000) : undefined,
    capturedTo: f.to ? Math.floor(Date.parse(`${f.to}T23:59:59Z`) / 1000) : undefined,
  }
}
